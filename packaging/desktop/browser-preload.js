const { contextBridge, ipcRenderer } = require("electron");

const DESKTOP_BROWSER_ENVELOPE_FROM_MAIN_CHANNEL = "space-desktop:browser-envelope-to-view";
const DESKTOP_BROWSER_ENVELOPE_TO_MAIN_CHANNEL = "space-desktop:browser-envelope-from-view";
const DESKTOP_BROWSER_TRANSPORT_KEY = "__spaceBrowserEmbedTransport__";
const SHADOW_OVERRIDE_FLAG = "__spaceDesktopBrowserShadowRootOverrideInstalled__";

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
    console.error("[space-desktop/browser-preload] Failed to install shadow-root override.", error);
  }
}

ipcRenderer.on(DESKTOP_BROWSER_ENVELOPE_FROM_MAIN_CHANNEL, (_event, payload = {}) => {
  try {
    receiveEnvelope?.(payload.envelope);
  } catch (error) {
    console.error("[space-desktop/browser-preload] Failed to deliver browser envelope.", error);
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
    ipcRenderer.send(DESKTOP_BROWSER_ENVELOPE_TO_MAIN_CHANNEL, {
      envelope
    });
  }
});
