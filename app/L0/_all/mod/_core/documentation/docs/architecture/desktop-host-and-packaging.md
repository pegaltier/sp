# Desktop Host And Packaging

This doc covers the Electron desktop host and the packaging scripts that build native desktop outputs.

## Primary Sources

- `packaging/AGENTS.md`
- `packaging/desktop/main.js`
- `packaging/desktop/server_storage_paths.js`
- `packaging/desktop/updater_artifacts.js`
- `packaging/desktop/updater_install_options.js`
- `packaging/desktop/updater_debug_release.js`
- `packaging/desktop/preload.js`
- `packaging/desktop/frame-preload.js`
- `packaging/desktop/browser-preload.js`
- `packaging/scripts/desktop-builder.js`
- `packaging/scripts/desktop-dev-run.js`
- `packaging/scripts/release-assets-stage.js`
- `packaging/scripts/release-metadata.js`
- `packaging/release-asset-filters.yaml`
- `app/package.json`
- `package.json`
- `server/app.js`

## Desktop Host Startup

The Electron host stays thin:

- it starts the existing Node server runtime from `server/app.js`
- it waits for `listen()` before reading runtime fields such as `browserUrl`
- it opens the browser UI inside `BrowserWindow`

Current startup contract:

- the desktop host binds the backend to `127.0.0.1`
- it passes `PORT=0`, so the OS assigns a free local port for that launch
- packaged apps also force `WORKERS=1`, so the standalone desktop host stays on the single-process server runtime
- before packaged startup finishes, the host resolves a stable desktop `userData` root and prefers the legacy rebrand-era packaged directory when it still owns `customware/` or `server/data`, so updates do not strand writable state under the old app name
- packaged apps also set `CUSTOMWARE_PATH` to `<userData>/customware`, so writable `L1/` and `L2/` content stays in the native OS user-data location instead of inside the installed app bundle
- packaged apps also pass `tmpDir=<temp>/space-agent/server-tmp`, so transient server artifacts live in a writable OS temp root instead of a read-only AppImage or installed bundle path
- packaged apps also export `SPACE_AUTH_DATA_DIR=<userData>/server/data`, so backend-only auth keys and local `userCrypto` server-share caches avoid read-only bundle paths too
- after `listen()`, the server runtime updates its public `port` and `browserUrl` fields to the resolved bound port
- the host loads `${browserUrl}${launchPath}` instead of reconstructing a fixed URL from config

## Packaged Versus Source-Checkout Behavior

Current Electron behavior differs only where the native-host contract requires it:

- packaged apps force `SINGLE_USER_APP=true`
- packaged apps force `WORKERS=1`
- packaged apps first resolve a stable native user-data root across desktop rebrands, preferring the legacy packaged directory when it still owns runtime state
- packaged apps persist writable customware under that native user-data root through `CUSTOMWARE_PATH`
- packaged apps store transient server temp artifacts under the native OS temp root through `tmpDir`
- packaged apps store backend-only auth fallback data under that native user-data root through `SPACE_AUTH_DATA_DIR`
- packaged apps open `/enter` as the recovery-safe launcher shell
- packaged apps also register an Electron frame preload that opens future shadow roots inside bundled-app subframes at document start and can later activate iframe `data-space-inject` module scripts there, with each opt-in iframe tracked by unique frame `name` plus `iframeId`
- desktop runs also expose `window.spaceDesktop.browser` on ordinary app routes so the renderer can discover desktop browser embedding metadata and any host-owned browser events without competing with the app-owned `window.space`
- packaged desktop browser windows now prefer a DOM `<webview>` inside the renderer-owned `<x-browser>` anchor so the remote page, modal chrome, rounded clipping, and resize chrome stay in the same compositor stack
- the Electron host must enable `webviewTag` for that window and use `will-attach-webview` to force the owned preload and browser-id metadata onto only the browser module's `space-browser-*` partitions
- desktop `<webview>` guests use `browser-webview-preload.js` to force future shadow roots open and to expose the same `__spaceBrowserEmbedTransport__` bridge that the injected browsing runtime uses
- the renderer-side browser module must wait for Electron `did-attach` or `dom-ready` before calling guest-only webview methods, must set the guest `src` imperatively during registration instead of binding `<webview src>` reactively through Alpine state so initial loads are not aborted by ordinary toolbar state updates, must keep the `<x-browser>` shell and its immediate rendered child hit-transparent so the real browser surface receives direct input, and must patch only the active webview host shadow-root frame chain so Electron's internal iframe fills the reserved shell while passive shadow-root siblings cannot intercept direct pointer input or reveal the modal's dark backing through transparent pages; browser-mode sessions still use the same toolbar and iframe fallback path, but without the desktop-only injected bridge features
- desktop `_blank` and `window.open(...)` behavior should stay in-app through the shared injected runtime's `open_window` events, so the browser module can open a new modal instead of spawning a separate OS window
- source-checkout desktop dev runs keep the normal runtime auth flow
- both packaged and source-checkout runs use the same free-port startup flow
- packaged release bundles lazy-load the Electron updater after the window is created, do not run a startup update check, expose launcher-shell runtime info plus explicit updater actions through `window.space` on `/enter` and `/login` only, let `/enter` run a fresh background check on each shell load unless an install is already downloading or ready to restart and reveal an update button only when a newer bundle exists, keep downloads and restart-to-install as explicit user actions, keep the `/enter` downloaded state labeled as `Restart and update`, fade that launcher shell to black before restart-to-install begins, keep auto-install on ordinary app quit disabled, keep explicit installs on the direct `electron-updater` handoff after fully closing the embedded server runtime, keep Windows on the stock silent NSIS restart path so `quitAndInstall(true, true)` still launches the installer directly, harden that Windows installer path inside `packaging/platforms/windows/installer.nsh` by waiting longer for running app processes under `$INSTDIR` to exit before uninstall or extraction continues, append best-effort Windows updater diagnostics to `<userData>/logs/desktop-updater.log` from both the main process and the installer-side NSIS hook, rely on the installer's stable NSIS GUID and the packaging-owned legacy uninstall-key migration include instead of overriding the target directory at runtime, disable the updater web-installer path because packaged releases publish only full NSIS installers, and if a Windows release metadata file omits the current build's installer arch the desktop host must fall back to the canonical `Space-Agent-<release version>-windows-<arch>.exe` asset for the running `process.arch` before it marks the update as downloaded, write a packaged install-attempt marker immediately before restart-to-install, clear stale updater `pending/` payloads from the current and legacy packaged cache roots on the next packaged launch while preserving ordinary downloaded-but-not-installed updates and reusable blockmaps, keep the native window title composed with the current page title so updater status remains visible on `/enter` and later routes while leaving the no-update result visually quiet, start the native window on a black background so first paint does not flash white, mirror readable updater diagnostics into the renderer console, show progress-bar status while checking or downloading, bypass the macOS close-to-hide path when restart-to-install is invoked because Electron closes windows before it emits `before-quit` during updater-triggered quits, disable differential downloads so packaged releases do not require uploaded blockmaps, stage debug reinstalls by fetching canonical GitHub Release metadata back into the shared updater path, and install them on restart instead of mutating installed files in place with the source-checkout `space update` command
- updater package-load failures, offline launch, and update-check network errors must not prevent the local server or browser window from launching

`preload.js` exposes `space` to the recovery-safe `/enter` and `/login` shells with `platform`, `getRuntimeInfo()`, `checkForUpdates()`, `downloadUpdate()`, `installUpdate()`, and `debugReinstall(version?)`, so those packaged launcher pages can trigger explicit native update actions without authenticated module dependencies while leaving the normal app runtime free to own `window.space` everywhere else. The same preload also exposes `spaceDesktop.browser` on ordinary app routes so the renderer can discover desktop browser embedding metadata and any host-side browser events. `frame-preload.js` is registered only for packaged iframe runs and still has two responsibilities: in every subframe it uses Electron's isolated-world bridge to run a document-start main-world `attachShadow(...)` override so future shadow roots are forced open before page code creates them, and in the top-level app frame it observes iframes that opt into `data-space-inject`; when one is found, the desktop host records that iframe under a unique frame `name` plus `iframeId`, waits for the corresponding Electron child frame to finish loading, resolves that child frame through Electron's main-process `webFrameMain.fromId(...)` lookup, fetches the referenced script through the live renderer session, rejects anything that is not same-origin or whose normalized path does not stay under `/mod/`, and then injects that module-owned runtime directly into the child frame without depending on the remote page's own CORS or CSP rules. `browser-webview-preload.js` is the preferred desktop browsing preload: it runs the same document-start shadow-root opening logic for packaged `<webview>` guests and exposes `__spaceBrowserEmbedTransport__` so the same injected runtime can handle `ping`, DOM reads, navigation requests, `open_window` events, and navigation-state events there without needing a second page-side protocol. The renderer-owned browser module treats `<webview src>` as an imperative lifecycle field rather than a reactive template binding, waits for Electron attach readiness before it reads guest-only navigation APIs, and then uses the shared bridge for steady-state toolbar sync. `browser-preload.js` remains the legacy native browser-view preload for the older `WebContentsView` path.

## Packaging Outputs

Desktop packaging is owned by `packaging/scripts/desktop-builder.js` plus thin per-platform entrypoints.

Current build behavior:

- reads the root `package.json` `build` config
- keeps the root `package.json` version aligned with the current Git-derived release version, because npm script banners and some packaging fallback paths read that metadata directly
- keeps desktop-host runtime modules such as `electron-updater` in the root `dependencies` block so they are copied into the packaged app, while `packaging/package.json` stays limited to build-tool dependencies
- normalizes tag-like versions such as `v0.22` to a semver build version through `packaging/scripts/release-version.js`, so CI and local packaging can stamp the desktop app version consistently; the resolver checks explicit `--app-version`, release env vars, an exact checked-out Git tag, and finally the root package version, and it also derives the published two-segment release version by stripping a redundant trailing `.0` patch when present while user-facing updater labels collapse that same redundant patch in the launcher UI and native window title
- keeps `directories.app` pinned to the repo root because the Electron host entry lives outside `app/`, while excluding repo-local `app/L1/` and `app/L2/` content because packaged apps relocate writable customware into `<userData>/customware`
- keeps `app/package.json` in the bundle so the app tree stays an ES module package boundary, which means that nested package file must keep basic metadata such as `name` and `version`
- includes both the extensionless `space` wrapper and `space.js` in the bundle so the packaged host still carries the documented CLI entrypoint surface it depends on
- keeps packaging scripts focused on building artifacts only; GitHub Release publishing is handled by the release workflow instead of by a local `--publish` script flag, with `release-assets-stage.js` preparing the final upload set
- keeps GitHub publish provider config in the effective build config so `electron-builder` emits updater metadata, while the wrapper passes `publish: null` so local and CI packaging scripts never upload directly; because `electron-builder` skips bundled `app-update.yml` on macOS `--dir` builds unless updater-capable targets are present, the wrapper must backfill that file into unpacked `.app` outputs for local updater testing
- keeps the canonical source icon artwork under `packaging/resources/icons/source/` and derives platform-specific packaging icons from it
- points macOS packaging at that source PNG so `electron-builder` can compile the final app icon internally, while Windows and Linux use checked-in derived assets under `packaging/platforms/`
- keeps Windows NSIS packaging configured to recreate desktop shortcuts on reinstall, pins an explicit canonical `nsis.guid`, and routes legacy rebrand-era uninstall-key migration plus installer-side update hardening through `packaging/platforms/windows/installer.nsh` so updater-driven installs keep a stable Windows identity instead of drifting with `appId` changes or reinstalling while app processes still linger
- keeps Linux maintainer metadata in `build.linux.maintainer`, so Linux package formats that require maintainer identity do not depend on the repo-wide package author field
- enables hardened-runtime signing inputs for macOS and keeps notarization credential discovery in the standard `electron-builder` environment-variable flow
- allows local macOS packaging without signing credentials by honoring `SKIP_SIGNING=1` in the desktop builder wrapper, and also accepts the launcher-style `APPLE_PASSWORD` env var as a local alias for `APPLE_APP_SPECIFIC_PASSWORD`
- publishes platform-specific GitHub updater metadata so packaged apps can resolve new installers and bundles from the GitHub Release they were built for, using the canonical release asset names `metadata-latest-windows.yml`, `metadata-latest-mac.yml`, `metadata-latest-linux.yml`, and `metadata-latest-linux-arm64.yml`; those metadata files are rewritten during staging to point only at canonical NSIS installers, AppImages, and macOS updater zips, and the packaged Windows host now also recognizes the canonical public installer names directly so it can recover when a published Windows metadata file drops one arch entry
- disables `npmRebuild` so optional native dependencies such as `nodegit` do not block desktop packaging when fallback Git backends are already available
- keeps `asar` disabled so the bundled project tree stays watchable on disk
- writes platform artifacts under `dist/desktop/<platform>/`
- for macOS, the default targets are `dmg` and `zip`; the DMG remains the user-facing installer while the ZIP remains the updater payload
- `--dir` produces an unpacked `.app` output for local inspection, and on macOS the packaging wrapper also backfills `Contents/Resources/app-update.yml` so those local unpacked builds can exercise the release updater

## Tagged Release Workflow

Repo-level desktop publishing lives in `.github/workflows/release-desktop.yml`.

Current release contract:

- the workflow runs automatically on pushed `v*` tags
- normal `main` branch pushes do not publish desktop releases unless the `v*` tag ref is pushed too
- automatic tag-push runs publish desktop artifacts when the selected tag is already on `origin/main` history and no newer `v*` tag is already on `origin/main` after it
- manual `workflow_dispatch` runs require an existing Git tag input and use that same gate, so failed or partial releases can be rebuilt after `main` has advanced as long as no newer release tag has already landed on `main` after the requested one
- fresh builds cover Windows, macOS, and Linux on both x64 and arm64 runners
- local and CI builds share the same packaging scripts, with CI passing the tag-derived semver build version through `SPACE_APP_VERSION`
- release notes are generated automatically from the commit range between the previous published release and the current tag, with an empty previous tag allowed when no prior published release is available, and CI prepends a fixed `## Downloads` table that links the canonical DMG, AppImage, and EXE assets for x86 and ARM before requiring the OpenRouter prompt helper under `packaging/resources/release-notes/` to return a non-empty AI-written body whose Markdown starts directly with the overview paragraph instead of repeating the release title, tag, or version that GitHub already renders outside the body
- the publish job merges per-arch macOS and Windows updater metadata, promotes Linux updater metadata into the canonical root names `metadata-latest-windows.yml`, `metadata-latest-mac.yml`, `metadata-latest-linux.yml`, and `metadata-latest-linux-arm64.yml`, rewrites those metadata files to the final canonical updater filenames, stages only the kept public installers according to `packaging/release-asset-filters.yaml`, and uploads the minimal updater payload set: NSIS installers, AppImages, canonical macOS updater zips, and metadata files
- staged public installer files use uniform `Space-Agent-<release version>-<platform>-<arch>.<extension>` asset names, while macOS updater zips use `Space-Agent-<release version>-macos-<arch>-update.zip`; when the semver patch is `0`, the workflow strips that redundant third number so tags such as `v0.40.0` publish as `Space-Agent-0.40-<platform>-<arch>.<extension>` and `Space-Agent-0.40-macos-<arch>-update.zip`, while the packaged app itself keeps the full semver build version required by the desktop toolchain
- every release run rebuilds fresh desktop artifacts, updates the GitHub Release for the selected tag, removes stale unprefixed selected-asset names left by older workflow attempts, and uploads that selected artifact set with `--clobber` so manual reruns replace failed or stale assets instead of publishing a second release

Use this doc together with `packaging/AGENTS.md` when you need the exact host-versus-server ownership split.
