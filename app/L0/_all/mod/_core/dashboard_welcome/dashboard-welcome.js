import "/mod/_core/spaces/store.js";
import { showToast } from "/mod/_core/visual/chrome/toast.js";
import {
  getSpaceDisplayIcon,
  getSpaceDisplayIconColor,
  getSpaceDisplayTitle
} from "/mod/_core/spaces/space-metadata.js";

const DASHBOARD_CONFIG_PATH = "~/conf/dashboard.yaml";
const EXAMPLES_BASE_PATH = "L0/_all/mod/_core/dashboard_welcome/examples";
const EXAMPLES_MODULE_PATH = "/mod/_core/dashboard_welcome/examples";
const EXAMPLES = Object.freeze([
  Object.freeze({
    description: "Status cards, signal checks, and quick notes.",
    icon: "sensors",
    iconColor: "#78d7ff",
    id: "signal-room",
    manifestUrl: `${EXAMPLES_MODULE_PATH}/signal-room/space.yaml`,
    sourcePath: `${EXAMPLES_BASE_PATH}/signal-room/`,
    title: "Signal Room",
    widgets: Object.freeze(["Mission Overview", "Pulse Grid", "Relay Notes"])
  }),
  Object.freeze({
    description: "Focus blocks, color studies, and a short idea stack.",
    icon: "palette",
    iconColor: "#ffb36b",
    id: "focus-studio",
    manifestUrl: `${EXAMPLES_MODULE_PATH}/focus-studio/space.yaml`,
    sourcePath: `${EXAMPLES_BASE_PATH}/focus-studio/`,
    title: "Focus Studio",
    widgets: Object.freeze(["Focus Rhythm", "Palette Shelf", "Idea Stack"])
  })
]);

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (!runtime.api || typeof runtime.api.fileRead !== "function" || typeof runtime.api.fileWrite !== "function") {
    throw new Error("space.api file helpers are not available.");
  }

  if (!runtime.spaces || typeof runtime.spaces.installExampleSpace !== "function") {
    throw new Error("space.spaces example helpers are not available.");
  }

  if (
    !runtime.utils ||
    typeof runtime.utils !== "object" ||
    !runtime.utils.yaml ||
    typeof runtime.utils.yaml.parse !== "function" ||
    typeof runtime.utils.yaml.stringify !== "function"
  ) {
    throw new Error("space.utils.yaml is not available.");
  }

  return runtime;
}

function isMissingFileError(error) {
  const message = String(error?.message || "");
  return /\bstatus 404\b/u.test(message) || /File not found\./u.test(message) || /Path not found\./u.test(message);
}

function parseStoredBoolean(value) {
  if (value === true || value === false) {
    return value;
  }

  const normalizedValue = String(value ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return false;
}

function normalizeDashboardPrefs(parsedConfig) {
  const storedConfig = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};

  return {
    welcomeHidden: parseStoredBoolean(storedConfig.welcome_hidden ?? storedConfig.welcomeHidden)
  };
}

function buildDashboardPrefsPayload(prefs = {}) {
  return {
    welcome_hidden: prefs.welcomeHidden === true
  };
}

async function loadDashboardPrefs() {
  const runtime = getRuntime();

  try {
    const result = await runtime.api.fileRead(DASHBOARD_CONFIG_PATH);
    return normalizeDashboardPrefs(runtime.utils.yaml.parse(String(result?.content || "")));
  } catch (error) {
    if (isMissingFileError(error)) {
      return normalizeDashboardPrefs({});
    }

    throw new Error(`Unable to load dashboard settings: ${error.message}`);
  }
}

async function saveDashboardPrefs(nextPrefs) {
  const runtime = getRuntime();
  const expectedPrefs = buildDashboardPrefsPayload(nextPrefs);
  const content = runtime.utils.yaml.stringify(expectedPrefs);

  try {
    await runtime.api.fileWrite(DASHBOARD_CONFIG_PATH, `${content}\n`);
    const result = await runtime.api.fileRead(DASHBOARD_CONFIG_PATH);
    const savedPrefs = normalizeDashboardPrefs(runtime.utils.yaml.parse(String(result?.content || "")));

    if (savedPrefs.welcomeHidden !== (expectedPrefs.welcome_hidden === true)) {
      throw new Error("Saved dashboard settings did not match the requested value.");
    }
  } catch (error) {
    throw new Error(`Unable to save dashboard settings: ${error.message}`);
  }
}

function logDashboardWelcomeError(context, error) {
  console.error(`[dashboard-welcome] ${context}`, error);
}

function normalizeExampleEntry(example = {}, manifest = {}) {
  return {
    ...example,
    displayIcon: getSpaceDisplayIcon(manifest.icon ?? example.icon),
    displayIconColor: getSpaceDisplayIconColor(manifest.iconColor ?? manifest.icon_color ?? example.iconColor),
    title: getSpaceDisplayTitle(manifest.title ?? example.title),
    widgets: [...(Array.isArray(example.widgets) ? example.widgets : [])]
  };
}

async function loadExampleManifest(example = {}) {
  const runtime = getRuntime();
  const response = await fetch(example.manifestUrl, {
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(`Unable to load example metadata (${response.status}).`);
  }

  return runtime.utils.yaml.parse(await response.text());
}

globalThis.dashboardWelcome = function dashboardWelcome() {
  return {
    examples: EXAMPLES.map((example) => normalizeExampleEntry(example)),
    hidden: false,
    installingExampleId: "",
    ready: false,
    savingPreference: false,

    async init() {
      try {
        const [prefs, examples] = await Promise.all([
          loadDashboardPrefs(),
          Promise.all(
            EXAMPLES.map(async (example) => {
              try {
                return normalizeExampleEntry(example, await loadExampleManifest(example));
              } catch (error) {
                logDashboardWelcomeError(`loadExampleManifest failed for ${example.id}`, error);
                return normalizeExampleEntry(example);
              }
            })
          )
        ]);
        this.hidden = prefs.welcomeHidden;
        this.examples = examples;
      } catch (error) {
        logDashboardWelcomeError("init failed", error);
        showToast(String(error?.message || "Unable to load the dashboard welcome panel."), {
          tone: "error"
        });
      } finally {
        this.ready = true;
      }
    },

    get isInstalling() {
      return Boolean(this.installingExampleId);
    },

    async setHidden(nextHidden) {
      const requestedHidden = nextHidden === true;

      if (this.savingPreference || this.hidden === requestedHidden) {
        return;
      }

      this.savingPreference = true;

      try {
        await saveDashboardPrefs({
          welcomeHidden: requestedHidden
        });
        this.hidden = requestedHidden;
      } catch (error) {
        logDashboardWelcomeError("setHidden failed", error);
        showToast(String(error?.message || "Unable to save that setting."), {
          tone: "error"
        });
      } finally {
        this.savingPreference = false;
      }
    },

    async hideWelcome() {
      await this.setHidden(true);
    },

    async showWelcome() {
      await this.setHidden(false);
    },

    async installExample(exampleId) {
      if (this.installingExampleId) {
        return;
      }

      const example = this.examples.find((entry) => entry.id === exampleId);

      if (!example) {
        return;
      }

      this.installingExampleId = example.id;

      try {
        const createdSpace = await globalThis.space.spaces.installExampleSpace({
          id: example.id,
          replace: false,
          sourcePath: example.sourcePath
        });

        showToast(`Opened "${getSpaceDisplayTitle(createdSpace)}".`, {
          tone: "success"
        });
      } catch (error) {
        logDashboardWelcomeError("installExample failed", error);
        showToast(String(error?.message || "Unable to open that demo space."), {
          tone: "error"
        });
      } finally {
        this.installingExampleId = "";
      }
    }
  };
};
