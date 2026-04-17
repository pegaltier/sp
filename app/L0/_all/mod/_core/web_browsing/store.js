import {
  getBrowserFrameBridge,
  send as sendBrowserFrameMessage
} from "./browser-frame-bridge.js";
import {
  collectWebviewNavigationState,
  focusWebview,
  getDesktopBrowserWebviewPartition,
  injectBrowserWebviewRuntime,
  isWebviewLike,
  loadWebviewUrl,
  navigateWebviewHistory,
  releaseWebviewEmbedder,
  reloadWebview,
  stabilizeWebviewEmbedder,
  usesDesktopBrowserWebview
} from "./browser-webview.js";
import {
  bindDesktopBrowserHostEvents,
  BROWSER_INJECT_PATH,
  focusBrowserSurface,
  goBackBrowserSurface,
  goForwardBrowserSurface,
  navigateBrowserSurface,
  registerBrowserSurface as registerDesktopBrowserSurface,
  reloadBrowserSurface,
  syncAllBrowserSurfaces,
  syncBrowserSurface as syncDesktopBrowserSurface,
  unregisterBrowserSurface as unregisterDesktopBrowserSurface,
  usesNativeDesktopBrowser
} from "./browser-surface.js";

const STORE_NAME = "webBrowsing";
const BROWSER_WINDOW_ID_PREFIX = "browser-";
const DEFAULT_FRAME_SRC = "/mod/_core/web_browsing/browser-frame.html";
const FRAME_REQUEST_TIMEOUT_MS = 450;
const FRAME_SYNC_ATTEMPTS = 5;
const FRAME_SYNC_DELAY_MS = 120;
const WINDOW_CASCADE_X_STEP = 28;
const WINDOW_CASCADE_Y_STEP = 24;
const WINDOW_MARGIN = 16;
const WINDOW_DRAG_TOP_MARGIN = 0;
const WINDOW_MIN_WIDTH = 360;
const WINDOW_MIN_HEIGHT = 260;
const WINDOW_EMERGENCY_MIN_WIDTH = 240;
const WINDOW_EMERGENCY_MIN_HEIGHT = 180;
const WINDOW_MINIMIZED_HEIGHT = 46;
const WINDOW_MINIMIZED_WIDTH_EM = 12;
const WINDOW_TOP_RESERVE_EM = 4.5;
const DEFAULT_HEIGHT_RATIO = 0.8;
const DEFAULT_MAX_HEIGHT_EM = 100;
const ROUTER_STAGE_APPROX_MAX_WIDTH_REM = 84;

let nextWindowZIndex = 2147481200;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundPx(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function wait(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, roundPx(ms)));
  });
}

function resolveMinimum(maxValue, preferredValue, emergencyFloor) {
  if (maxValue <= 0) {
    return emergencyFloor;
  }

  if (maxValue <= emergencyFloor) {
    return Math.round(maxValue);
  }

  return Math.min(preferredValue, Math.round(maxValue));
}

function readRootFontSize() {
  const root = globalThis.document?.documentElement;

  if (!(root instanceof HTMLElement)) {
    return 16;
  }

  const resolvedValue = Number.parseFloat(globalThis.getComputedStyle(root).fontSize);
  return Number.isFinite(resolvedValue) && resolvedValue > 0 ? resolvedValue : 16;
}

function getMinimizedWidthPx() {
  return Math.round(readRootFontSize() * WINDOW_MINIMIZED_WIDTH_EM);
}

function getTopReservePx() {
  return Math.round(readRootFontSize() * WINDOW_TOP_RESERVE_EM);
}

function getDefaultMaxHeightPx() {
  return Math.round(readRootFontSize() * DEFAULT_MAX_HEIGHT_EM);
}

function getViewportSize() {
  return {
    width: Math.max(roundPx(globalThis.window?.innerWidth, 0), WINDOW_EMERGENCY_MIN_WIDTH),
    height: Math.max(
      roundPx(globalThis.window?.innerHeight, 0),
      WINDOW_MINIMIZED_HEIGHT + getTopReservePx() + WINDOW_MARGIN
    )
  };
}

function getAvailableWindowArea() {
  const viewport = getViewportSize();

  return {
    height: Math.max(WINDOW_MINIMIZED_HEIGHT, viewport.height - WINDOW_DRAG_TOP_MARGIN - WINDOW_MARGIN),
    left: WINDOW_MARGIN,
    top: WINDOW_DRAG_TOP_MARGIN,
    width: Math.max(WINDOW_EMERGENCY_MIN_WIDTH, viewport.width - (WINDOW_MARGIN * 2))
  };
}

function getSpawnWindowArea() {
  const viewport = getViewportSize();
  const top = WINDOW_MARGIN + getTopReservePx();

  return {
    height: Math.max(WINDOW_MINIMIZED_HEIGHT, viewport.height - top - WINDOW_MARGIN),
    left: WINDOW_MARGIN,
    top,
    width: Math.max(WINDOW_EMERGENCY_MIN_WIDTH, viewport.width - (WINDOW_MARGIN * 2))
  };
}

function getApproximateRouterStageMetrics(area = getAvailableWindowArea()) {
  const maxStageWidth = Math.round(readRootFontSize() * ROUTER_STAGE_APPROX_MAX_WIDTH_REM);
  const width = clamp(
    Math.min(area.width, maxStageWidth),
    WINDOW_EMERGENCY_MIN_WIDTH,
    Math.max(WINDOW_EMERGENCY_MIN_WIDTH, area.width)
  );

  return {
    left: area.left + Math.max(0, Math.round((area.width - width) / 2)),
    width
  };
}

function getExpandedSizeBounds(area = getAvailableWindowArea()) {
  const minWidth = resolveMinimum(area.width, WINDOW_MIN_WIDTH, WINDOW_EMERGENCY_MIN_WIDTH);
  const minHeight = resolveMinimum(area.height, WINDOW_MIN_HEIGHT, WINDOW_EMERGENCY_MIN_HEIGHT);

  return {
    maxHeight: Math.max(minHeight, Math.round(area.height)),
    maxWidth: Math.max(minWidth, Math.round(area.width)),
    minHeight,
    minWidth
  };
}

function getDefaultExpandedSize(spawnArea = getSpawnWindowArea(), clampArea = getAvailableWindowArea()) {
  const bounds = getExpandedSizeBounds(clampArea);
  const routerStage = getApproximateRouterStageMetrics(clampArea);
  const viewport = getViewportSize();
  const preferredHeight = Math.min(
    Math.round(viewport.height * DEFAULT_HEIGHT_RATIO),
    getDefaultMaxHeightPx()
  );

  return {
    height: clamp(preferredHeight, bounds.minHeight, bounds.maxHeight),
    width: clamp(Math.round(routerStage.width), bounds.minWidth, bounds.maxWidth)
  };
}

function getDefaultPosition(size, spawnArea = getSpawnWindowArea(), clampArea = getAvailableWindowArea(), cascadeIndex = 0) {
  const maxX = clampArea.left + Math.max(0, clampArea.width - size.width);
  const maxY = clampArea.top + Math.max(0, clampArea.height - size.height);
  const offsetX = Math.min(
    Math.max(0, cascadeIndex) * WINDOW_CASCADE_X_STEP,
    Math.max(0, clampArea.width - size.width)
  );
  const offsetY = Math.min(
    Math.max(0, cascadeIndex) * WINDOW_CASCADE_Y_STEP,
    Math.max(0, clampArea.height - size.height)
  );
  const routerStage = getApproximateRouterStageMetrics(clampArea);

  return {
    x: clamp(routerStage.left + offsetX, clampArea.left, maxX),
    y: clamp(spawnArea.top + offsetY, clampArea.top, maxY)
  };
}

function clampPosition(position, size, area = getAvailableWindowArea()) {
  const width = Math.max(0, roundPx(size?.width));
  const height = Math.max(0, roundPx(size?.height));
  const maxX = area.left + Math.max(0, area.width - width);
  const maxY = area.top + Math.max(0, area.height - height);

  return {
    x: clamp(roundPx(position?.x, area.left), area.left, maxX),
    y: clamp(roundPx(position?.y, area.top), area.top, maxY)
  };
}

function getRightAnchoredPosition(position, previousSize, nextSize, area = getAvailableWindowArea()) {
  return clampPosition({
    x: roundPx(position?.x, area.left) + Math.max(0, roundPx(previousSize?.width)) - Math.max(0, roundPx(nextSize?.width)),
    y: roundPx(position?.y, area.top)
  }, nextSize, area);
}

function getNextZIndex() {
  nextWindowZIndex += 1;
  return nextWindowZIndex;
}

function releasePointerCapture(interaction) {
  try {
    interaction?.captureTarget?.releasePointerCapture?.(interaction.pointerId);
  } catch {
    // Ignore release failures from stale or detached capture targets.
  }
}

function getBrowserBaseUrl() {
  return String(globalThis.window?.location?.href || globalThis.location?.href || "http://localhost/");
}

function getBrowserOriginUrl() {
  try {
    return new URL(getBrowserBaseUrl()).origin;
  } catch {
    return "http://localhost";
  }
}

function resolveDefaultFrameSrc() {
  return new URL(DEFAULT_FRAME_SRC, `${getBrowserOriginUrl()}/`).href;
}

function resolveBrowserLocation(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  try {
    return new URL(normalizedValue, getBrowserBaseUrl()).href;
  } catch {
    return normalizedValue;
  }
}

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  return runtime;
}

function buildRuntimeBrowserWindowSnapshot(browserWindow) {
  if (!browserWindow || typeof browserWindow !== "object") {
    return null;
  }

  return {
    ...browserWindow,
    position: browserWindow.position && typeof browserWindow.position === "object"
      ? { ...browserWindow.position }
      : browserWindow.position,
    size: browserWindow.size && typeof browserWindow.size === "object"
      ? { ...browserWindow.size }
      : browserWindow.size
  };
}

function normalizeCreateWindowOptions(value) {
  if (typeof value === "string") {
    const url = String(value).trim();
    return url ? { url } : {};
  }

  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function createRuntimeBrowserHandle(store, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return null;
  }

  const requireWindow = () => {
    const browserWindow = store.getWindow(normalizedId);

    if (!browserWindow) {
      throw new Error(`Browser window "${normalizedId}" was not found.`);
    }

    return browserWindow;
  };

  return {
    get bridge() {
      try {
        return getBrowserFrameBridge(normalizedId);
      } catch {
        return null;
      }
    },
    close() {
      requireWindow();
      store.closeWindow(normalizedId);
    },
    focus(options = {}) {
      requireWindow();
      store.focusWindow(normalizedId, options);
      return store.getWindow(normalizedId);
    },
    forward() {
      requireWindow();
      return store.goForward(normalizedId);
    },
    get id() {
      return normalizedId;
    },
    navigate(url) {
      requireWindow();
      store.updateAddressValue(normalizedId, String(url ?? ""));
      return store.navigateToAddress(normalizedId);
    },
    reload() {
      requireWindow();
      return store.reloadFrame(normalizedId);
    },
    send(type, payload = null, options = {}) {
      requireWindow();
      return sendBrowserFrameMessage(normalizedId, type, payload, options);
    },
    sync(options = {}) {
      requireWindow();
      return store.syncNavigationState(normalizedId, options);
    },
    get state() {
      return buildRuntimeBrowserWindowSnapshot(store.getWindow(normalizedId));
    },
    back() {
      requireWindow();
      return store.goBack(normalizedId);
    },
    get window() {
      return store.getWindow(normalizedId);
    }
  };
}

function ensureBrowserRuntimeNamespace(store) {
  const runtime = getRuntime();
  const previousNamespace = runtime.browser && typeof runtime.browser === "object" ? runtime.browser : {};
  const getHandle = (id) => {
    const normalizedId = String(id || "").trim();

    if (!normalizedId || !store.getWindow(normalizedId)) {
      return null;
    }

    return createRuntimeBrowserHandle(store, normalizedId);
  };
  const requireHandle = (id) => {
    const handle = getHandle(id);

    if (!handle) {
      throw new Error(`Browser window "${String(id || "").trim()}" was not found.`);
    }

    return handle;
  };
  const namespace = {
    ...previousNamespace,
    back(id) {
      return requireHandle(id).back();
    },
    close(id) {
      const normalizedId = String(id || "").trim();

      if (!normalizedId) {
        return;
      }

      store.closeWindow(normalizedId);
    },
    create(options = {}) {
      return store.createWindow(normalizeCreateWindowOptions(options));
    },
    focus(id, options = {}) {
      const normalizedId = String(id || "").trim();

      if (!normalizedId) {
        return null;
      }

      store.focusWindow(normalizedId, options);
      return getHandle(normalizedId);
    },
    forward(id) {
      return requireHandle(id).forward();
    },
    get(id) {
      return getHandle(id);
    },
    ids() {
      return store.windows.map((browserWindow) => browserWindow.id);
    },
    list() {
      return store.windows.map((browserWindow) => buildRuntimeBrowserWindowSnapshot(browserWindow));
    },
    navigate(id, url) {
      return requireHandle(id).navigate(url);
    },
    open(options = {}) {
      return store.createWindow(normalizeCreateWindowOptions(options));
    },
    reload(id) {
      return requireHandle(id).reload();
    },
    send(id, type, payload = null, options = {}) {
      return sendBrowserFrameMessage(id, type, payload, options);
    },
    sync(id, options = {}) {
      return requireHandle(id).sync(options);
    }
  };

  runtime.browser = namespace;
  return namespace;
}

function normalizeTypedBrowserLocation(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//iu.test(normalizedValue) || /^(about|blob|data|file|mailto|tel):/iu.test(normalizedValue)) {
    return resolveBrowserLocation(normalizedValue);
  }

  if (/^[/?#.]/u.test(normalizedValue)) {
    return resolveBrowserLocation(normalizedValue);
  }

  return resolveBrowserLocation(`https://${normalizedValue}`);
}

function extractBrowserWindowOrdinal(id) {
  const match = String(id || "").trim().match(/^browser-(\d+)$/u);
  const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isBrowserWindowIdInUse(id, windows, root = globalThis.document) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    return false;
  }

  if (windows.some((browserWindow) => browserWindow?.id === normalizedId)) {
    return true;
  }

  if (root?.getElementById?.(normalizedId)) {
    return true;
  }

  return Boolean(root?.getElementsByName?.(normalizedId)?.length);
}

function getNextBrowserWindowId(windows, root = globalThis.document) {
  const usedOrdinals = new Set(
    windows
      .map((browserWindow) => extractBrowserWindowOrdinal(browserWindow?.id))
      .filter((ordinal) => ordinal != null)
  );

  let nextOrdinal = 1;
  while (usedOrdinals.has(nextOrdinal) || isBrowserWindowIdInUse(`${BROWSER_WINDOW_ID_PREFIX}${nextOrdinal}`, windows, root)) {
    nextOrdinal += 1;
  }

  return `${BROWSER_WINDOW_ID_PREFIX}${nextOrdinal}`;
}

function readNavigationCapability(navigation, key) {
  return typeof navigation?.[key] === "boolean" ? navigation[key] : null;
}

function collectIframeFallbackState(iframe) {
  if (!iframe) {
    return null;
  }

  let canGoBack = false;
  let canGoForward = false;
  let title = "";
  let url = "";

  try {
    url = String(iframe.contentWindow?.location?.href || "");
    title = String(iframe.contentDocument?.title || "");

    const navigation = iframe.contentWindow?.navigation;
    const navigationCanGoBack = readNavigationCapability(navigation, "canGoBack");
    const navigationCanGoForward = readNavigationCapability(navigation, "canGoForward");

    canGoBack = navigationCanGoBack == null
      ? Number(iframe.contentWindow?.history?.length || 0) > 1
      : navigationCanGoBack;
    canGoForward = navigationCanGoForward == null ? false : navigationCanGoForward;
  } catch {
    // Cross-origin iframes fall back to their exposed src attribute only.
  }

  const fallbackUrl = resolveBrowserLocation(iframe.src || iframe.getAttribute?.("src") || "");
  if (!url || (url === "about:blank" && fallbackUrl && fallbackUrl !== "about:blank")) {
    url = fallbackUrl;
  }

  return {
    canGoBack,
    canGoForward,
    title,
    url
  };
}

function createBrowserWindowState(id, cascadeIndex = 0, options = {}) {
  const clampArea = getAvailableWindowArea();
  const spawnArea = getSpawnWindowArea();
  const size = getDefaultExpandedSize(spawnArea, clampArea);
  const initialUrl = String(options.url || "").trim();
  const frameSrc = resolveBrowserLocation(initialUrl || resolveDefaultFrameSrc());

  return {
    addressValue: frameSrc,
    bridgeStateReady: false,
    canGoBack: false,
    canGoForward: false,
    currentUrl: frameSrc,
    frameSrc,
    id,
    isMinimized: false,
    position: getDefaultPosition(size, spawnArea, clampArea, cascadeIndex),
    size: { ...size },
    zIndex: getNextZIndex()
  };
}

const model = {
  frameConnections: Object.create(null),
  interaction: null,
  offDesktopBrowserHostEvents: null,
  syncTokens: Object.create(null),
  windows: [],

  mount() {
    ensureBrowserRuntimeNamespace(this);

    if (!this.offDesktopBrowserHostEvents) {
      this.offDesktopBrowserHostEvents = bindDesktopBrowserHostEvents({
        onFocus: (id) => {
          if (id) {
            this.focusWindow(id, {
              fromBrowserSurface: true
            });
          }
        },
        onOpenWindow: (event) => {
          const url = String(event?.url || "").trim();
          this.createWindow(url ? { url } : {});
        }
      });
    }

    this.windows.forEach((browserWindow) => {
      this.ensureWindowGeometry(browserWindow);
    });
    if (this.usesNativeDesktopSurface) {
      syncAllBrowserSurfaces();
    }
  },

  unmount() {
    this.stopPointer();

    if (typeof this.offDesktopBrowserHostEvents === "function") {
      this.offDesktopBrowserHostEvents();
    }

    this.offDesktopBrowserHostEvents = null;
  },

  get hasOpenWindows() {
    return this.windows.length > 0;
  },

  get usesNativeDesktopSurface() {
    return usesNativeDesktopBrowser();
  },

  get usesDesktopWebviewSurface() {
    return usesDesktopBrowserWebview();
  },

  getWindow(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return null;
    }

    return this.windows.find((browserWindow) => browserWindow.id === normalizedId) || null;
  },

  getIframe(id) {
    const connection = this.frameConnections[String(id || "").trim()];
    if (connection?.iframe) {
      return connection.iframe;
    }

    const element = globalThis.document?.getElementById?.(String(id || "").trim());
    return String(element?.tagName || "").toUpperCase() === "IFRAME" ? element : null;
  },

  getWebview(id) {
    const connection = this.frameConnections[String(id || "").trim()];
    if (connection?.webview) {
      return connection.webview;
    }

    const element = globalThis.document?.getElementById?.(String(id || "").trim());
    return isWebviewLike(element) ? element : null;
  },

  webviewPartition(id) {
    return getDesktopBrowserWebviewPartition(id);
  },

  nextSyncToken(id) {
    const normalizedId = String(id || "").trim();
    const nextToken = (Number(this.syncTokens[normalizedId]) || 0) + 1;
    this.syncTokens[normalizedId] = nextToken;
    return nextToken;
  },

  createWindow(options = {}) {
    const id = getNextBrowserWindowId(this.windows);
    const browserWindow = createBrowserWindowState(id, this.windows.length, options);

    this.windows = [...this.windows, browserWindow];
    this.focusWindow(id);

    return id;
  },

  openFromMenu() {
    return this.createWindow();
  },

  focusWindow(id, options = {}) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    browserWindow.zIndex = getNextZIndex();

    if (this.usesNativeDesktopSurface && !options.fromBrowserSurface && options.focusSurface !== false) {
      focusBrowserSurface(browserWindow.id);
    }

    if (this.usesNativeDesktopSurface) {
      syncDesktopBrowserSurface(browserWindow.id);
    }
  },

  handleWindowPointerDown(id, event) {
    const target = event?.target;
    const shouldKeepChromeFocus = target instanceof Element
      && Boolean(target.closest(".web-browsing-window-toolbar"));

    this.focusWindow(id, {
      focusSurface: !shouldKeepChromeFocus
    });
  },

  ensureWindowGeometry(browserWindow) {
    if (!browserWindow) {
      return;
    }

    const area = getAvailableWindowArea();
    const bounds = getExpandedSizeBounds(area);

    browserWindow.size = {
      height: clamp(roundPx(browserWindow.size?.height, bounds.maxHeight), bounds.minHeight, bounds.maxHeight),
      width: clamp(roundPx(browserWindow.size?.width, bounds.maxWidth), bounds.minWidth, bounds.maxWidth)
    };
    browserWindow.position = clampPosition(browserWindow.position, this.getPanelSize(browserWindow), area);
  },

  getPanelSize(browserWindow) {
    if (!browserWindow) {
      return {
        height: WINDOW_MINIMIZED_HEIGHT,
        width: getMinimizedWidthPx()
      };
    }

    const area = getAvailableWindowArea();
    const bounds = getExpandedSizeBounds(area);
    const expandedSize = {
      height: clamp(roundPx(browserWindow.size?.height, bounds.maxHeight), bounds.minHeight, bounds.maxHeight),
      width: clamp(roundPx(browserWindow.size?.width, bounds.maxWidth), bounds.minWidth, bounds.maxWidth)
    };

    if (browserWindow.isMinimized) {
      return {
        height: Math.min(WINDOW_MINIMIZED_HEIGHT, area.height),
        width: clamp(getMinimizedWidthPx(), Math.min(bounds.minWidth, bounds.maxWidth), bounds.maxWidth)
      };
    }

    return expandedSize;
  },

  closeWindow(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    if (this.interaction?.windowId === browserWindow.id) {
      this.stopPointer();
    }

    this.unregisterBrowserSurface(browserWindow.id);
    this.unregisterWebview(browserWindow.id);
    this.unregisterIframe(browserWindow.id);
    this.windows = this.windows.filter((entry) => entry.id !== browserWindow.id);
  },

  toggleMinimized(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    this.stopPointer();
    this.focusWindow(id);

    const area = getAvailableWindowArea();
    const previousSize = this.getPanelSize(browserWindow);

    browserWindow.isMinimized = !browserWindow.isMinimized;
    this.ensureWindowGeometry(browserWindow);

    const nextSize = this.getPanelSize(browserWindow);
    browserWindow.position = getRightAnchoredPosition(browserWindow.position, previousSize, nextSize, area);
    if (this.usesNativeDesktopSurface) {
      syncDesktopBrowserSurface(browserWindow.id);
    }
  },

  handleViewportResize() {
    this.windows.forEach((browserWindow) => {
      this.ensureWindowGeometry(browserWindow);
    });
    if (this.usesNativeDesktopSurface) {
      syncAllBrowserSurfaces();
    }
  },

  startDrag(id, event) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.focusWindow(id);

    const interaction = {
      captureTarget: event.currentTarget,
      originPosition: { ...browserWindow.position },
      panelSize: this.getPanelSize(browserWindow),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      type: "drag",
      windowId: browserWindow.id
    };

    interaction.captureTarget?.setPointerCapture?.(event.pointerId);
    this.interaction = interaction;
  },

  startResize(id, event) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow || browserWindow.isMinimized || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.focusWindow(id);

    const bounds = getExpandedSizeBounds();
    const interaction = {
      captureTarget: event.currentTarget,
      originSize: {
        height: clamp(roundPx(browserWindow.size?.height, bounds.maxHeight), bounds.minHeight, bounds.maxHeight),
        width: clamp(roundPx(browserWindow.size?.width, bounds.maxWidth), bounds.minWidth, bounds.maxWidth)
      },
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      type: "resize",
      windowId: browserWindow.id
    };

    interaction.captureTarget?.setPointerCapture?.(event.pointerId);
    this.interaction = interaction;
  },

  handlePointerMove(event) {
    const interaction = this.interaction;

    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }

    const browserWindow = this.getWindow(interaction.windowId);
    if (!browserWindow) {
      this.stopPointer(event);
      return;
    }

    event.preventDefault();

    if (interaction.type === "drag") {
      browserWindow.position = clampPosition({
        x: interaction.originPosition.x + (event.clientX - interaction.startX),
        y: interaction.originPosition.y + (event.clientY - interaction.startY)
      }, interaction.panelSize);
      if (this.usesNativeDesktopSurface) {
        syncDesktopBrowserSurface(browserWindow.id);
      }
      return;
    }

    const bounds = getExpandedSizeBounds();
    browserWindow.size = {
      height: Math.round(clamp(interaction.originSize.height + (event.clientY - interaction.startY), bounds.minHeight, bounds.maxHeight)),
      width: Math.round(clamp(interaction.originSize.width + (event.clientX - interaction.startX), bounds.minWidth, bounds.maxWidth))
    };
    browserWindow.position = clampPosition(browserWindow.position, this.getPanelSize(browserWindow));
    if (this.usesNativeDesktopSurface) {
      syncDesktopBrowserSurface(browserWindow.id);
    }
  },

  stopPointer(event) {
    const interaction = this.interaction;

    if (!interaction) {
      return;
    }

    if (event && interaction.pointerId !== event.pointerId) {
      return;
    }

    const browserWindow = this.getWindow(interaction.windowId);

    releasePointerCapture(interaction);
    this.interaction = null;

    if (browserWindow) {
      this.ensureWindowGeometry(browserWindow);
      if (this.usesNativeDesktopSurface) {
        syncDesktopBrowserSurface(browserWindow.id);
      }
    }
  },

  panelStyle(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return {};
    }

    const panelSize = this.getPanelSize(browserWindow);

    return {
      height: `${panelSize.height}px`,
      left: `${browserWindow.position.x}px`,
      top: `${browserWindow.position.y}px`,
      width: `${panelSize.width}px`,
      zIndex: String(browserWindow.zIndex)
    };
  },

  registerIframe(id, iframe) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow || !iframe) {
      return;
    }

    this.unregisterIframe(id);

    let bridge = null;
    let offNavigationState = null;
    let offOpenWindow = null;

    try {
      bridge = getBrowserFrameBridge(id);
      offNavigationState = bridge.on("navigation_state", (message) => {
        this.applyNavigationState(id, message.payload, { fromBridge: true });
      });
      offOpenWindow = bridge.on("open_window", (message) => {
        const url = String(message?.payload?.url || "").trim();
        this.createWindow(url ? { url } : {});
      });
    } catch {
      // The host bridge remains optional outside packaged desktop runs.
    }

    this.frameConnections[browserWindow.id] = {
      bridge,
      iframe,
      offNavigationState,
      offOpenWindow,
      webview: null
    };

    this.applyNavigationState(id, collectIframeFallbackState(iframe));
    void this.syncNavigationState(id);
  },

  registerBrowserSurface(id, element) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow || !element || !this.usesNativeDesktopSurface) {
      return;
    }

    this.unregisterIframe(id);

    let bridge = null;
    let offNavigationState = null;
    let offOpenWindow = null;

    try {
      bridge = getBrowserFrameBridge(id);
      offNavigationState = bridge.on("navigation_state", (message) => {
        this.applyNavigationState(id, message.payload, { fromBridge: true });
      });
      offOpenWindow = bridge.on("open_window", (message) => {
        const url = String(message?.payload?.url || "").trim();
        this.createWindow(url ? { url } : {});
      });
    } catch {
      // The host bridge remains optional while the native view is still initializing.
    }

    this.frameConnections[browserWindow.id] = {
      bridge,
      iframe: null,
      offNavigationState,
      offOpenWindow,
      webview: null
    };

    registerDesktopBrowserSurface(browserWindow.id, element, {
      injectPath: BROWSER_INJECT_PATH,
      url: browserWindow.currentUrl || browserWindow.frameSrc
    });

    void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 3 });
  },

  registerWebview(id, webview, initialUrl = "") {
    const browserWindow = this.getWindow(id);
    if (!browserWindow || !isWebviewLike(webview)) {
      return;
    }

    const stabilizeEmbedder = () => {
      stabilizeWebviewEmbedder(webview);
      globalThis.requestAnimationFrame?.(() => {
        stabilizeWebviewEmbedder(webview);
      });
    };

    stabilizeEmbedder();

    this.unregisterIframe(id);
    this.unregisterWebview(id);

    const normalizedInitialUrl = resolveBrowserLocation(
      initialUrl || browserWindow.currentUrl || browserWindow.frameSrc || DEFAULT_FRAME_SRC
    );
    const runtimeState = {
      attached: false,
      injected: false
    };

    if (normalizedInitialUrl) {
      browserWindow.addressValue = normalizedInitialUrl;
      browserWindow.currentUrl = normalizedInitialUrl;
      browserWindow.frameSrc = normalizedInitialUrl;
    }

    let bridge = null;
    let offNavigationState = null;
    let offOpenWindow = null;

    try {
      bridge = getBrowserFrameBridge(id);
      offNavigationState = bridge.on("navigation_state", (message) => {
        this.applyNavigationState(id, message.payload, { fromBridge: true });
      });
      offOpenWindow = bridge.on("open_window", (message) => {
        const url = String(message?.payload?.url || "").trim();
        this.createWindow(url ? { url } : {});
      });
    } catch {
      // The guest bridge may not be ready until the first preload runs.
    }

    const syncState = (fallbackUrl = normalizedInitialUrl) => {
      const state = runtimeState.attached
        ? collectWebviewNavigationState(webview)
        : {
            url: resolveBrowserLocation(fallbackUrl || browserWindow.currentUrl || browserWindow.frameSrc || "")
          };
      this.applyNavigationState(id, state);
    };
    const ensureInitialSrc = () => {
      stabilizeEmbedder();

      const nextUrl = resolveBrowserLocation(
        browserWindow.currentUrl || browserWindow.frameSrc || normalizedInitialUrl || DEFAULT_FRAME_SRC
      );
      if (!nextUrl) {
        return;
      }

      const currentSrc = resolveBrowserLocation(webview.getAttribute?.("src") || webview.src || "");
      if (currentSrc === nextUrl) {
        return;
      }

      webview.setAttribute("src", nextUrl);
    };
    const handleDidAttach = () => {
      runtimeState.attached = true;
      stabilizeEmbedder();
      ensureInitialSrc();
      syncState();
    };
    const handleDidStartLoading = () => {
      browserWindow.bridgeStateReady = false;
      stabilizeEmbedder();
      syncState();
    };
    const handleDidStopLoading = () => {
      stabilizeEmbedder();
      syncState();
      void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 3 });
    };
    const handleNavigationEvent = () => {
      stabilizeEmbedder();
      syncState();
    };
    const handlePointerDown = () => {
      focusWebview(webview);
    };
    const handleDomReady = () => {
      runtimeState.attached = true;
      stabilizeEmbedder();
      focusWebview(webview);
      if (runtimeState.injected) {
        syncState();
        void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 3 });
        return;
      }

      runtimeState.injected = true;
      void injectBrowserWebviewRuntime(webview, {
        browserId: browserWindow.id,
        injectPath: BROWSER_INJECT_PATH
      }).then(() => {
        syncState();
        return this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 3 });
      }).catch(() => {
        runtimeState.injected = false;
        syncState();
      });
    };

    const webviewListeners = [
      ["did-attach", handleDidAttach],
      ["did-start-loading", handleDidStartLoading],
      ["did-stop-loading", handleDidStopLoading],
      ["did-navigate", handleNavigationEvent],
      ["did-navigate-in-page", handleNavigationEvent],
      ["page-title-updated", handleNavigationEvent],
      ["dom-ready", handleDomReady],
      ["pointerdown", handlePointerDown],
      ["mousedown", handlePointerDown]
    ];

    webviewListeners.forEach(([eventName, handler]) => {
      webview.addEventListener(eventName, handler);
    });

    this.frameConnections[browserWindow.id] = {
      bridge,
      iframe: null,
      offNavigationState,
      offOpenWindow,
      offWebviewEvents() {
        webviewListeners.forEach(([eventName, handler]) => {
          webview.removeEventListener(eventName, handler);
        });
      },
      webview
    };

    syncState(normalizedInitialUrl);
    ensureInitialSrc();
  },

  unregisterBrowserSurface(id, element = null) {
    unregisterDesktopBrowserSurface(id, element);

    const normalizedId = String(id || "").trim();
    const connection = this.frameConnections[normalizedId];
    if (!connection || connection.iframe) {
      return;
    }

    if (typeof connection.offNavigationState === "function") {
      connection.offNavigationState();
    }

    if (typeof connection.offOpenWindow === "function") {
      connection.offOpenWindow();
    }

    connection.bridge?.destroy?.();
    delete this.frameConnections[normalizedId];
    delete this.syncTokens[normalizedId];
  },

  unregisterWebview(id, webview = null) {
    const normalizedId = String(id || "").trim();
    const connection = this.frameConnections[normalizedId];
    if (!connection?.webview) {
      return;
    }

    if (webview && connection.webview !== webview) {
      return;
    }

    if (typeof connection.offNavigationState === "function") {
      connection.offNavigationState();
    }

    if (typeof connection.offOpenWindow === "function") {
      connection.offOpenWindow();
    }

    if (typeof connection.offWebviewEvents === "function") {
      connection.offWebviewEvents();
    }

    releaseWebviewEmbedder(connection.webview);
    connection.bridge?.destroy?.();
    delete this.frameConnections[normalizedId];
    delete this.syncTokens[normalizedId];
  },

  unregisterIframe(id, iframe = null) {
    const normalizedId = String(id || "").trim();
    const connection = this.frameConnections[normalizedId];

    if (!connection) {
      return;
    }

    if (iframe && connection.iframe && connection.iframe !== iframe) {
      return;
    }

    if (typeof connection.offNavigationState === "function") {
      connection.offNavigationState();
    }

    if (typeof connection.offOpenWindow === "function") {
      connection.offOpenWindow();
    }

    connection.bridge?.destroy?.();
    delete this.frameConnections[normalizedId];
    delete this.syncTokens[normalizedId];
  },

  applyNavigationState(id, state, options = {}) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow || !state || typeof state !== "object") {
      return;
    }

    const resolvedUrl = resolveBrowserLocation(state.url || browserWindow.currentUrl || browserWindow.frameSrc || "");
    if (resolvedUrl) {
      browserWindow.addressValue = resolvedUrl;
      browserWindow.currentUrl = resolvedUrl;
      browserWindow.frameSrc = resolvedUrl;
    }

    if (typeof state.canGoBack === "boolean") {
      browserWindow.canGoBack = state.canGoBack;
    }

    if (typeof state.canGoForward === "boolean") {
      browserWindow.canGoForward = state.canGoForward;
    }

    if (options.fromBridge) {
      browserWindow.bridgeStateReady = true;
    }
  },

  async requestBridgePayload(id, type, payload = null, options = {}) {
    const normalizedId = String(id || "").trim();
    const connection = this.frameConnections[normalizedId];
    const bridge = connection?.bridge;

    if (!bridge) {
      return null;
    }

    try {
      const response = await bridge.request(type, payload, {
        timeoutMs: Math.max(1, Number(options.timeoutMs) || FRAME_REQUEST_TIMEOUT_MS)
      });
      return response?.payload ?? null;
    } catch {
      return null;
    }
  },

  async syncNavigationState(id, options = {}) {
    const normalizedId = String(id || "").trim();
    const token = this.nextSyncToken(normalizedId);
    const attempts = Math.max(1, Number(options.attempts) || FRAME_SYNC_ATTEMPTS);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.syncTokens[normalizedId] !== token || !this.getWindow(normalizedId)) {
        return false;
      }

      const payload = await this.requestBridgePayload(normalizedId, "navigation_state_get", null, {
        timeoutMs: FRAME_REQUEST_TIMEOUT_MS + (attempt * 150)
      });

      if (payload) {
        if (this.syncTokens[normalizedId] !== token || !this.getWindow(normalizedId)) {
          return false;
        }

        this.applyNavigationState(normalizedId, payload, { fromBridge: true });
        return true;
      }

      if (attempt < attempts - 1) {
        await wait(FRAME_SYNC_DELAY_MS * (attempt + 1));
      }
    }

    const webview = this.getWebview(normalizedId);
    if (webview) {
      this.applyNavigationState(normalizedId, collectWebviewNavigationState(webview));
      return false;
    }

    const iframe = this.getIframe(normalizedId);
    this.applyNavigationState(normalizedId, collectIframeFallbackState(iframe));

    return false;
  },

  handleFrameLoad(id, event) {
    const browserWindow = this.getWindow(id);
    if (browserWindow) {
      browserWindow.bridgeStateReady = false;
    }

    const iframe = event?.currentTarget;
    this.applyNavigationState(id, collectIframeFallbackState(iframe));
    void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 2 });
  },

  updateAddressValue(id, value) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    browserWindow.addressValue = String(value ?? "");
  },

  async navigateToAddress(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    const nextUrl = normalizeTypedBrowserLocation(browserWindow.addressValue || browserWindow.currentUrl || browserWindow.frameSrc);
    if (!nextUrl) {
      browserWindow.addressValue = browserWindow.currentUrl || browserWindow.frameSrc || "";
      return;
    }

    this.focusWindow(id);

    if (nextUrl === browserWindow.currentUrl) {
      void this.reloadFrame(id);
      return;
    }

    browserWindow.addressValue = nextUrl;
    browserWindow.currentUrl = nextUrl;
    browserWindow.frameSrc = nextUrl;
    const payload = browserWindow.bridgeStateReady
      ? await this.requestBridgePayload(id, "location_navigate", {
          url: nextUrl
        })
      : null;

    if (!payload) {
      this.performNavigateFallback(id, nextUrl);
    }

    browserWindow.bridgeStateReady = false;
    void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 2 });
  },

  performNavigateFallback(id, nextUrl) {
    const normalizedUrl = resolveBrowserLocation(nextUrl || "");
    if (!normalizedUrl) {
      return false;
    }

    const iframe = this.getIframe(id);
    if (iframe) {
      iframe.src = normalizedUrl;
      return true;
    }

    const webview = this.getWebview(id);
    if (webview) {
      return loadWebviewUrl(webview, normalizedUrl);
    }

    if (this.usesNativeDesktopSurface) {
      navigateBrowserSurface(id, normalizedUrl);
      return true;
    }

    return false;
  },

  performHistoryFallback(id, direction) {
    const iframe = this.getIframe(id);
    if (iframe) {
      try {
        iframe.contentWindow?.history?.[direction]?.();
        return true;
      } catch {
        return false;
      }
    }

    const webview = this.getWebview(id);
    if (webview) {
      return navigateWebviewHistory(webview, direction);
    }

    if (!this.usesNativeDesktopSurface) {
      return false;
    }

    if (direction === "back") {
      goBackBrowserSurface(id);
      return true;
    }

    if (direction === "forward") {
      goForwardBrowserSurface(id);
      return true;
    }

    return false;
  },

  performReloadFallback(id) {
    const iframe = this.getIframe(id);
    if (iframe) {
      try {
        iframe.contentWindow?.location?.reload?.();
        return true;
      } catch {
        // Fall back to resetting the current src when the child page is cross-origin.
      }

      const src = resolveBrowserLocation(iframe.src || iframe.getAttribute?.("src") || this.getWindow(id)?.frameSrc || "");
      if (!src) {
        return false;
      }

      iframe.src = src;
      return true;
    }

    const webview = this.getWebview(id);
    if (webview) {
      return reloadWebview(webview);
    }

    if (!this.usesNativeDesktopSurface) {
      return false;
    }

    reloadBrowserSurface(id);
    return true;
  },

  async goBack(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    this.focusWindow(id);

    const payload = browserWindow.bridgeStateReady
      ? await this.requestBridgePayload(id, "history_back")
      : null;

    if (!payload) {
      this.performHistoryFallback(id, "back");
    }

    void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 2 });
  },

  async goForward(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    this.focusWindow(id);

    const payload = browserWindow.bridgeStateReady
      ? await this.requestBridgePayload(id, "history_forward")
      : null;

    if (!payload) {
      this.performHistoryFallback(id, "forward");
    }

    void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 2 });
  },

  async reloadFrame(id) {
    const browserWindow = this.getWindow(id);
    if (!browserWindow) {
      return;
    }

    this.focusWindow(id);

    const payload = browserWindow.bridgeStateReady
      ? await this.requestBridgePayload(id, "location_reload")
      : null;

    if (!payload) {
      this.performReloadFallback(id);
    }

    browserWindow.bridgeStateReady = false;
    void this.syncNavigationState(id, { attempts: FRAME_SYNC_ATTEMPTS + 2 });
  }
};

const webBrowsingStore = space.fw.createStore(STORE_NAME, model);
ensureBrowserRuntimeNamespace(webBrowsingStore);
