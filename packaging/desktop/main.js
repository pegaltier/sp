const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, net } = require("electron");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SERVER_APP_PATH = path.join(PROJECT_ROOT, "server", "app.js");
const BASE_WINDOW_TITLE = "Space Agent";

let serverRuntime;
let mainWindow;
let isQuitting = false;
let hasPromptedForDownloadedUpdate = false;
let updateStatusClearTimer = null;
let desktopAutoUpdater = null;

function createDesktopRuntimeParamOverrides() {
  const overrides = {};

  if (app.isPackaged) {
    overrides.SINGLE_USER_APP = "true";
    overrides.CUSTOMWARE_PATH = path.join(app.getPath("userData"), "customware");
  }

  return overrides;
}

function createDesktopServerOptions(runtimeParamOverrides) {
  return {
    host: "127.0.0.1",
    port: 0,
    projectRoot: PROJECT_ROOT,
    runtimeParamOverrides
  };
}

function resolveDesktopLaunchPath() {
  return serverRuntime?.runtimeParams?.get?.("SINGLE_USER_APP", false) ? "/enter" : "/";
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function clearUpdateStatusSoon(delayMs = 5000) {
  if (updateStatusClearTimer) {
    clearTimeout(updateStatusClearTimer);
  }

  updateStatusClearTimer = setTimeout(() => {
    updateStatusClearTimer = null;
    setDesktopUpdateStatus("");
  }, delayMs);
}

function setDesktopUpdateStatus(message, progress = null) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const normalizedMessage = String(message || "").trim();
  mainWindow.setTitle(normalizedMessage ? `${BASE_WINDOW_TITLE} - ${normalizedMessage}` : BASE_WINDOW_TITLE);

  if (progress === "indeterminate") {
    mainWindow.setProgressBar(2);
    return;
  }

  if (Number.isFinite(progress)) {
    mainWindow.setProgressBar(Math.max(0, Math.min(1, progress)));
    return;
  }

  mainWindow.setProgressBar(-1);
}

function shouldEnableDesktopAutoUpdate() {
  return app.isPackaged;
}

function loadDesktopAutoUpdater() {
  if (desktopAutoUpdater) {
    return desktopAutoUpdater;
  }

  try {
    ({ autoUpdater: desktopAutoUpdater } = require("electron-updater"));
  } catch (error) {
    console.warn("Desktop auto-update is unavailable.");
    console.warn(error && (error.stack || error.message || error));
    desktopAutoUpdater = null;
  }

  return desktopAutoUpdater;
}

function isDesktopNetworkOnline() {
  try {
    return !net || typeof net.isOnline !== "function" || net.isOnline();
  } catch (error) {
    logDesktopUpdateError("Could not determine desktop network status.", error);
    return true;
  }
}

function logDesktopUpdateError(message, error) {
  console.warn(message);
  console.warn(error && (error.stack || error.message || error));
}

async function promptForDownloadedUpdate(info) {
  if (hasPromptedForDownloadedUpdate) {
    return;
  }

  hasPromptedForDownloadedUpdate = true;
  const detail = [
    `Version ${info?.version || "unknown"} is ready to install.`,
    "Restart now to apply the update, or keep working and install it when you quit."
  ].join("\n\n");
  const options = {
    type: "info",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Update Ready",
    message: "A new Space Agent release has been downloaded.",
    detail
  };
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);

  if (response === 0) {
    setImmediate(() => {
      desktopAutoUpdater?.quitAndInstall();
    });
  }
}

function configureDesktopAutoUpdate() {
  if (!shouldEnableDesktopAutoUpdate()) {
    return;
  }

  const autoUpdater = loadDesktopAutoUpdater();
  if (!autoUpdater) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking GitHub Releases for a desktop update...");
    setDesktopUpdateStatus("Checking for updates...", "indeterminate");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`Desktop update available: ${info.version}`);
    setDesktopUpdateStatus(`Downloading update ${info.version || ""}`.trim(), 0);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("Desktop app is already up to date.");
    setDesktopUpdateStatus("Up to date");
    clearUpdateStatusSoon();
  });

  autoUpdater.on("error", (error) => {
    logDesktopUpdateError("Desktop auto-update failed.", error);
    setDesktopUpdateStatus("Update check failed");
    clearUpdateStatusSoon(8000);
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number(progress && progress.percent);
    if (!Number.isFinite(percent)) {
      setDesktopUpdateStatus("Downloading update...", "indeterminate");
      return;
    }

    setDesktopUpdateStatus(`Downloading update ${Math.round(percent)}%`, percent / 100);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`Desktop update downloaded: ${info.version}`);
    setDesktopUpdateStatus("Update ready to install");
    promptForDownloadedUpdate(info).catch((error) => {
      logDesktopUpdateError("Could not show the restart prompt for the downloaded update.", error);
    });
  });

  setTimeout(() => {
    if (!isDesktopNetworkOnline()) {
      console.log("Skipping desktop update check while offline.");
      return;
    }

    try {
      const updateCheck = autoUpdater.checkForUpdates();
      if (updateCheck && typeof updateCheck.catch === "function") {
        updateCheck.catch((error) => {
          logDesktopUpdateError("Desktop auto-update check failed.", error);
        });
      }
    } catch (error) {
      logDesktopUpdateError("Desktop auto-update check failed.", error);
    }
  }, 10000);
}

async function loadCreateAgentServer() {
  const serverModule = await import(pathToFileURL(SERVER_APP_PATH).href);
  return serverModule.createAgentServer;
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f2efe8",
    title: "Space Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    // On macOS, Cmd+W should hide the app and preserve renderer state.
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`${serverRuntime.browserUrl}${resolveDesktopLaunchPath()}`);
  return mainWindow;
}

function stopServerRuntime() {
  if (!serverRuntime) {
    return;
  }

  const runtime = serverRuntime;
  serverRuntime = null;

  if (runtime.watchdog && typeof runtime.watchdog.stop === "function") {
    runtime.watchdog.stop();
  }

  if (runtime.tmpWatch && typeof runtime.tmpWatch.stop === "function") {
    runtime.tmpWatch.stop();
  }

  if (runtime.server && runtime.server.listening) {
    runtime.server.close();
  }
}

async function startDesktop() {
  await app.whenReady();
  const runtimeParamOverrides = createDesktopRuntimeParamOverrides();
  const createAgentServer = await loadCreateAgentServer();
  serverRuntime = await createAgentServer(createDesktopServerOptions(runtimeParamOverrides));
  await serverRuntime.listen();
  createWindow();
  configureDesktopAutoUpdate();

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServerRuntime();
});

startDesktop().catch((error) => {
  console.error("Failed to start desktop harness.");
  console.error(error);
  app.quit();
});
