const { contextBridge, ipcRenderer } = require("electron");

const DESKTOP_BROWSER_WEBVIEW_ENVELOPE_CHANNEL = "space.web_browsing.browser_frame";
const DESKTOP_BROWSER_TRANSPORT_KEY = "__spaceBrowserEmbedTransport__";
const SHADOW_OVERRIDE_FLAG = "__spaceDesktopBrowserWebviewShadowRootOverrideInstalled__";

let receiveEnvelope = null;

function installShadowRootOverride() {
  if (typeof contextBridge?.executeInMainWorld !== "function") {
    return;
  }

  try {
    contextBridge.executeInMainWorld({
      func: (flagKey) => {
        if (globalThis[flagKey] || typeof globalThis.Element?.prototype?.attachShadow !== "function") {
          return;
        }

        const originalAttachShadow = globalThis.Element.prototype.attachShadow;
        globalThis.Element.prototype.attachShadow = function attachShadow(options) {
          const shadowOptions = options && typeof options === "object"
            ? { ...options, mode: "open" }
            : { mode: "open" };

          return originalAttachShadow.call(this, shadowOptions);
        };
        globalThis[flagKey] = true;
      },
      args: [SHADOW_OVERRIDE_FLAG]
    });
  } catch (error) {
    console.error("[space-desktop/browser-webview-preload] Failed to install shadow-root override.", error);
  }
}

ipcRenderer.on(DESKTOP_BROWSER_WEBVIEW_ENVELOPE_CHANNEL, (_event, envelope) => {
  try {
    receiveEnvelope?.(envelope);
  } catch (error) {
    console.error("[space-desktop/browser-webview-preload] Failed to deliver browser envelope.", error);
  }
});

installShadowRootOverride();

contextBridge.exposeInMainWorld(DESKTOP_BROWSER_TRANSPORT_KEY, {
  bindReceiver(listener) {
    receiveEnvelope = typeof listener === "function" ? listener : null;

    return () => {
      if (receiveEnvelope === listener) {
        receiveEnvelope = null;
      }
    };
  },

  sendEnvelope(envelope) {
    ipcRenderer.sendToHost(DESKTOP_BROWSER_WEBVIEW_ENVELOPE_CHANNEL, envelope);
  }
});
