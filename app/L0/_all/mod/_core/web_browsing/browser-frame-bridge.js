import {
  BROWSER_FRAME_BRIDGE_CHANNEL,
  createWindowMessageBridge
} from "./browser-frame-protocol.js";
import {
  getBrowserWebviewBridge
} from "./browser-webview-bridge.js";
import {
  isWebviewLike
} from "./browser-webview.js";
import {
  getDesktopBrowserBridge,
  hasDesktopBrowserBridge
} from "./browser-native-bridge.js";

const DEFAULT_SEND_TIMEOUT_MS = 5000;
const bridgeCache = new WeakMap();

function isIframeLike(value) {
  const tagName = String(value?.tagName || value?.nodeName || "").toUpperCase();
  return tagName === "IFRAME";
}

function resolveFrameTarget(target) {
  if (!target) {
    return null;
  }

  if (isIframeLike(target)) {
    return target.contentWindow || null;
  }

  if (typeof target.contentWindow?.postMessage === "function") {
    return target.contentWindow;
  }

  if (typeof target.postMessage === "function") {
    return target;
  }

  return null;
}

function resolveIframeById(iframeId, root = globalThis.document) {
  const normalizedId = String(iframeId || "").trim();
  if (!normalizedId) {
    throw new Error("Browser frame helper requires a non-empty browser id.");
  }

  const iframe = root?.getElementById?.(normalizedId);
  if (!isIframeLike(iframe)) {
    throw new Error(`Browser frame helper could not find iframe "${normalizedId}".`);
  }

  return iframe;
}

export function createBrowserFrameBridge(target, options = {}) {
  const resolveTargetWindow =
    typeof target === "function"
      ? () => resolveFrameTarget(target())
      : () => resolveFrameTarget(target);

  return createWindowMessageBridge({
    ...options,
    channel: options.channel || BROWSER_FRAME_BRIDGE_CHANNEL,
    resolveTargetWindow
  });
}

export function getBrowserFrameBridge(iframeId, options = {}) {
  const normalizedId = String(iframeId || "").trim();
  if (!normalizedId) {
    throw new Error("Browser frame helper requires a non-empty browser id.");
  }

  const iframe = options.root?.getElementById?.(normalizedId) || globalThis.document?.getElementById?.(normalizedId);
  if (isWebviewLike(iframe)) {
    return getBrowserWebviewBridge(iframe, options);
  }

  if (isIframeLike(iframe)) {
    if (bridgeCache.has(iframe)) {
      return bridgeCache.get(iframe);
    }

    const bridge = createBrowserFrameBridge(iframe, options);
    bridgeCache.set(iframe, bridge);
    return bridge;
  }

  if (hasDesktopBrowserBridge()) {
    return getDesktopBrowserBridge(normalizedId, options);
  }

  resolveIframeById(normalizedId, options.root);
  throw new Error(`Browser frame helper could not resolve a browser target for "${normalizedId}".`);
}

export async function send(iframeId, type, payload = null, options = {}) {
  const bridge = getBrowserFrameBridge(iframeId, options);
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_SEND_TIMEOUT_MS;
  const response = await bridge.request(type, payload, { timeoutMs });

  return response.payload;
}
