import "/mod/_core/spaces/store.js";
import { showToast } from "/mod/_core/visual/chrome/toast.js";
import {
  getSpaceDisplayIcon,
  getSpaceDisplayIconColor,
  getSpaceDisplayTitle
} from "/mod/_core/spaces/space-metadata.js";

const TAU = Math.PI * 2;
const EMPTY_SPACE_FLOAT_PROFILE = Object.freeze({
  orbitPeriodMs: 12400,
  rotationAmplitude: 3.2,
  rotationPeriodMs: 17600,
  xRadius: 7.2,
  yRadius: 8.2
});

function logDashboardSpacesError(context, error) {
  console.error(`[spaces-dashboard] ${context}`, error);
}

function applyFloatingTitlePose(element, x, y, rotation) {
  if (!element) {
    return;
  }

  element.style.setProperty("--dashboard-empty-title-float-x", `${x.toFixed(1)}px`);
  element.style.setProperty("--dashboard-empty-title-float-y", `${y.toFixed(1)}px`);
  element.style.setProperty("--dashboard-empty-title-rotate", `${rotation.toFixed(1)}deg`);
}

function startFloatingTitleAnimation(element, motionQuery = null) {
  if (!element) {
    return () => {};
  }

  let frame = 0;
  let startTime = 0;

  const resetPose = () => {
    applyFloatingTitlePose(element, 0, 0, 0);
  };

  const step = (timestamp) => {
    if (!element.isConnected) {
      frame = 0;
      return;
    }

    if (motionQuery?.matches) {
      frame = 0;
      startTime = 0;
      resetPose();
      return;
    }

    if (!startTime) {
      startTime = timestamp;
    }

    const elapsed = timestamp - startTime;
    const orbitAngle = ((elapsed / EMPTY_SPACE_FLOAT_PROFILE.orbitPeriodMs) * TAU) + 0.45;
    const rotationAngle = ((elapsed / EMPTY_SPACE_FLOAT_PROFILE.rotationPeriodMs) * TAU) + 1.1;

    applyFloatingTitlePose(
      element,
      Math.cos(orbitAngle) * EMPTY_SPACE_FLOAT_PROFILE.xRadius,
      Math.sin(orbitAngle) * EMPTY_SPACE_FLOAT_PROFILE.yRadius,
      Math.sin(rotationAngle) * EMPTY_SPACE_FLOAT_PROFILE.rotationAmplitude
    );

    frame = window.requestAnimationFrame(step);
  };

  const start = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    startTime = 0;
    resetPose();

    if (!element.isConnected || motionQuery?.matches) {
      return;
    }

    frame = window.requestAnimationFrame(step);
  };

  const handleMotionPreferenceChange = () => {
    start();
  };

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", handleMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(handleMotionPreferenceChange);
    }
  }

  start();

  return () => {
    window.cancelAnimationFrame(frame);
    frame = 0;

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      } else if (typeof motionQuery.removeListener === "function") {
        motionQuery.removeListener(handleMotionPreferenceChange);
      }
    }

    resetPose();
  };
}

function normalizeWidgetPreviewNames(entry) {
  return (Array.isArray(entry?.widgetPreviewNames) ? entry.widgetPreviewNames : Array.isArray(entry?.widgetNames) ? entry.widgetNames : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function normalizeSpaceEntry(entry = {}) {
  const widgetPreviewNames = normalizeWidgetPreviewNames(entry);
  const totalWidgetNames = Array.isArray(entry?.widgetNames) ? entry.widgetNames.length : widgetPreviewNames.length;
  const displayTitle = getSpaceDisplayTitle(entry);

  return {
    ...entry,
    displayIcon: getSpaceDisplayIcon(entry),
    displayIconColor: getSpaceDisplayIconColor(entry),
    displayTitle,
    localeUpdatedAt: String(entry?.updatedAtLabel || "").trim() || "Unknown update time",
    remainingWidgetCount: Math.max(0, totalWidgetNames - widgetPreviewNames.length),
    widgetPreviewNames
  };
}

globalThis.spacesDashboardLauncher = function spacesDashboardLauncher() {
  return {
    creating: false,
    duplicatingSpaceId: "",
    deletingSpaceId: "",
    emptyTitleAnimationCleanup: null,
    emptyTitleAnimationFrame: 0,
    entries: [],
    loadErrorText: "",
    loading: false,
    motionQuery: null,

    async init() {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      await this.loadSpaces();
    },

    destroy() {
      this.stopEmptyTitleAnimation();
      window.cancelAnimationFrame(this.emptyTitleAnimationFrame);
      this.emptyTitleAnimationFrame = 0;
    },

    get hasEntries() {
      return this.entries.length > 0;
    },

    queueEmptyTitleAnimationSync() {
      window.cancelAnimationFrame(this.emptyTitleAnimationFrame);
      this.emptyTitleAnimationFrame = window.requestAnimationFrame(() => {
        this.emptyTitleAnimationFrame = 0;

        const element = this.$refs?.emptyTitle;
        this.stopEmptyTitleAnimation();

        if (!element) {
          return;
        }

        this.emptyTitleAnimationCleanup = startFloatingTitleAnimation(element, this.motionQuery);
      });
    },

    stopEmptyTitleAnimation() {
      if (typeof this.emptyTitleAnimationCleanup === "function") {
        this.emptyTitleAnimationCleanup();
      }

      this.emptyTitleAnimationCleanup = null;
    },

    async loadSpaces() {
      this.stopEmptyTitleAnimation();
      this.loading = true;
      this.loadErrorText = "";

      try {
        const items = await globalThis.space.spaces.listSpaces();
        this.entries = items.map((item) => normalizeSpaceEntry(item));
      } catch (error) {
        logDashboardSpacesError("loadSpaces failed", error);
        this.loadErrorText = String(error?.message || "Unable to load spaces.");
      } finally {
        this.loading = false;
        this.queueEmptyTitleAnimationSync();
      }
    },

    async createSpace() {
      if (this.creating) {
        return;
      }

      this.creating = true;

      try {
        await globalThis.space.spaces.createSpace();
      } catch (error) {
        logDashboardSpacesError("createSpace failed", error);
        showToast(String(error?.message || "Unable to create a space."), {
          tone: "error"
        });
      } finally {
        this.creating = false;
      }
    },

    async duplicateSpace(spaceId) {
      const normalizedSpaceId = String(spaceId || "").trim();
      const entry = this.entries.find((item) => item?.id === normalizedSpaceId);
      const label = String(entry?.displayTitle || entry?.title || normalizedSpaceId || "this space");

      if (!normalizedSpaceId || this.duplicatingSpaceId === normalizedSpaceId || this.deletingSpaceId === normalizedSpaceId) {
        return;
      }

      this.duplicatingSpaceId = normalizedSpaceId;

      try {
        const duplicatedSpace = await globalThis.space.spaces.duplicateSpace(normalizedSpaceId);
        this.entries = [normalizeSpaceEntry(duplicatedSpace), ...this.entries];
        showToast(`Duplicated "${label}".`, {
          tone: "success"
        });
      } catch (error) {
        logDashboardSpacesError("duplicateSpace failed", error);
        showToast(String(error?.message || "Unable to duplicate that space."), {
          tone: "error"
        });
      } finally {
        this.duplicatingSpaceId = "";
        this.queueEmptyTitleAnimationSync();
      }
    },

    async deleteSpace(spaceId) {
      const normalizedSpaceId = String(spaceId || "").trim();
      const entry = this.entries.find((item) => item?.id === normalizedSpaceId);
      const label = String(entry?.displayTitle || entry?.title || normalizedSpaceId || "this space");
      const nextEntries = this.entries.filter((item) => item?.id !== normalizedSpaceId);

      if (!normalizedSpaceId || this.deletingSpaceId === normalizedSpaceId || this.duplicatingSpaceId === normalizedSpaceId) {
        return;
      }

      if (!globalThis.confirm(`Delete "${label}"? This removes the whole space.`)) {
        return;
      }

      this.deletingSpaceId = normalizedSpaceId;

      try {
        await globalThis.space.spaces.removeSpace(normalizedSpaceId);
        this.entries = nextEntries;
        showToast(`Deleted "${label}".`, {
          tone: "success"
        });
      } catch (error) {
        logDashboardSpacesError("deleteSpace failed", error);
        showToast(String(error?.message || "Unable to delete that space."), {
          tone: "error"
        });
      } finally {
        this.deletingSpaceId = "";
        this.queueEmptyTitleAnimationSync();
      }
    },

    async openSpace(spaceId) {
      try {
        await globalThis.space.spaces.openSpace(spaceId);
      } catch (error) {
        logDashboardSpacesError("openSpace failed", error);
        showToast(String(error?.message || "Unable to open that space."), {
          tone: "error"
        });
      }
    }
  };
};
