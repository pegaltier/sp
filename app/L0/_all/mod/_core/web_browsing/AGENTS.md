# AGENTS

## Purpose

`_core/web_browsing/` owns the browser overlay module.

It contributes a Browser action to the routed onscreen menu and mounts draggable, minimizable, resizable floating browser windows through the router overlay seam. This module stays self-contained: it ships the floating shell, the host-side window store, the `<x-browser>` surface anchor, the browser bridge adapters, the placeholder page, and the injected runtime path that browser iframes and desktop-native views can both use.

Documentation is top priority for this module. After any change under `_core/web_browsing/`, update this file, affected parent docs, and the matching supplemental docs under `_core/documentation/docs/` in the same session.

## Ownership

This module owns:

- `menu-item.html`: real Browser dropdown action component for the routed onscreen menu
- `window.html`: floating browser-window component mounted into the router overlay layer; it owns the `<x-browser>` anchor and the browser-only iframe fallback markup
- `store.js`: shared Alpine store for the window list, unique `browser-N` id generation, geometry, focus, drag, resize, minimize, toolbar state, and browser-surface lifecycle
- `window.css`: local floating-window styling, title bar, toolbar chrome, browser-surface shell, and resize handle
- `browser-frame.html`: module-owned iframe placeholder page used as the first local page inside each window
- `browser-frame-protocol.js`: shared browser-bridge envelope protocol, payload normalization, and iframe-window request-response bridge factory
- `browser-frame-bridge.js`: outside-side helper that Space Agent surfaces can use to talk to a browser surface by `browser-N` id, whether the current runtime uses an iframe or a desktop-native view
- `browser-native-bridge.js`: renderer-side desktop adapter that wraps the Electron `spaceDesktop.browser` bridge in the same request-response shape used by the iframe helper
- `browser-webview.js`: renderer-side desktop `<webview>` helpers for partition naming, immediate navigation-state reads, and runtime injection into desktop guest pages
- `browser-webview-bridge.js`: renderer-side request-response bridge for desktop `<webview>` guests using `ipc-message` and `send(...)` on the embedder element
- `browser-surface.js`: renderer-side `<x-browser>` lifecycle and geometry helper that creates, updates, focuses, and destroys desktop-native browser views while leaving browser sessions on the iframe fallback path
- `browser-frame-inject.js`: inside-side bridge runtime fetched and evaluated by the packaged desktop host or addressed through iframe `postMessage`; it owns the built-in `ping`, `dom`, `navigation_state_get`, `location_navigate`, `history_back`, `history_forward`, and `location_reload` request handlers plus navigation-state event emission
- `ext/html/_core/onscreen_menu/items/browser.html`: thin routed menu-item adapter
- `ext/html/page/router/overlay/end/browser-window.html`: thin routed overlay adapter

## Local Contracts

- this module must mount only through `_core/onscreen_menu/items` and `page/router/overlay/end`; do not hardcode it into `_core/onscreen_menu/` or `_core/router/`
- the routed menu action is owned here through `_core/onscreen_menu/items` with `data-order="250"`
- the routed menu action must open a new floating browser window each time it is clicked without changing the current route
- floating windows are viewport-fixed, draggable from their compact title bar, minimizable and closable from their header controls, resizable from their bottom-right handle, and clamped only to the live viewport edges; only the initial spawn position should reserve extra top clearance in `em` units below the routed top bar
- resizing should allow the window to grow to the full available viewport area instead of stopping at a smaller fixed max width or height
- the bottom-right resize handle should stay visibly above iframe content and scrollbars as modal-owned chrome, using a small cut-corner treatment that matches the window shell while keeping the drag target larger than the visible backing
- minimizing a window should collapse it to a fixed `12em` width while anchoring the right edge in place so the minimize or restore button stays under the cursor
- window state is browser-local only in this pass; the module must not create backend state or persist geometry yet
- new windows should spawn near the left edge of the centered router stage column, should default to approximately that column width instead of spanning the full wide-screen viewport, and should default to roughly `80vh` height capped at `100em`
- each window body must reserve its content area through a `<x-browser data-browser-id="browser-N">` anchor; browser sessions render an iframe fallback inside that anchor, while desktop runs may map the same anchor to a native browser view
- the `<x-browser>` shell must consume the full remaining window-body height below the toolbar, must stay hit-transparent so it never steals clicks or scroll from the active browser surface, its immediate rendered child should also stay hit-transparent for the desktop embed path, and whichever inner browser surface is active must fill that shell in both axes instead of falling back to the embedder element's default intrinsic height
- packaged desktop runs must prefer a DOM-backed `<webview>` inside that `<x-browser>` anchor so modal clipping, rounded corners, resize chrome, and inter-window stacking stay in the same compositor layer as the browser-window shell
- each iframe fallback must load `/mod/_core/web_browsing/browser-frame.html`, must carry `data-space-inject="/mod/_core/web_browsing/browser-frame-inject.js"` on the iframe element itself, and must use the same unique `browser-N` id and `name` pair as the owning window
- iframe fallback startup must resolve that placeholder against the current app origin and must not let the iframe's transient pre-load `about:blank` state overwrite the intended local placeholder URL
- the title bar must expose a quick-add button on the left that opens another browser window and must use a non-plus restore icon on the minimize or restore control
- each non-minimized window must render a toolbar above the browser surface with an address field plus Back, Forward, and Reload buttons in both browser and native-app runs; in browser-mode sessions the placeholder page still loads first and the address or reload controls drive the iframe fallback even though injected navigation features remain inactive there
- toolbar pointer interaction must raise the owning browser modal without immediately refocusing the native browser surface, so the address field and toolbar buttons keep normal DOM focus inside packaged desktop runs
- this module must expose a narrow `space.browser` runtime namespace for console and cross-feature access; it should mirror the current `browser-N` window list through `ids()` and `list()`, expose top-level `open(...)`, `create(...)`, `send(browserId, ...)`, and direct navigation helpers keyed by browser id, expose `get(browserId)` for per-window handles, and make `space.browser.get("browser-1").send(...)` the simple per-window bridge entry point without turning the full Alpine store into a public runtime contract
- the outside helper at `/mod/_core/web_browsing/browser-frame-bridge.js` must expose a console-friendly `send(browserId, type, payload)` request helper that resolves browser ids across either the iframe fallback or the desktop-native bridge and returns the response payload
- every bridge envelope must be prefixed by the module-local `space.web_browsing.browser_frame` channel and must include `type` plus JSON-safe `payload`; request and response envelopes must also carry `requestId`, and responses should reuse the originating request `type`
- packaged desktop runs now use three related browser-side injection paths: the packaged frame preload still owns iframe `data-space-inject` activation for browser-mode iframes; the preferred desktop path renders a DOM `<webview>` inside `<x-browser>`, with Electron `will-attach-webview` forcing the owned preload and browser id metadata; and the legacy desktop-native `WebContentsView` path may still exist as a host fallback but must not be the primary browser-window surface while DOM clipping and stacking matter
- the desktop `<webview>` path must expose the same `__spaceBrowserEmbedTransport__` bridge from its preload, must inject the shared `/mod/_core/web_browsing/browser-frame-inject.js` runtime into each guest page after `dom-ready`, and must keep toolbar navigation state fresh from both immediate embedder reads and bridge events
- desktop `<webview>` helper reads and fallback toolbar actions must tolerate pre-`dom-ready` guests without throwing; until Electron enables navigation methods, host-side state should fall back to the embedder `src` and retry after the normal `dom-ready` plus bridge sync path
- desktop `<webview>` markup must not bind guest `src` reactively from Alpine state; the store should set the initial `src` imperatively during registration and use bridge or fallback navigation methods for later changes so toolbar sync does not restart guest loads
- desktop `<webview>` registration must also patch only the active host shadow-root frame chain so Electron's internal guest iframe fills the full shell height, passive shadow-root siblings do not intercept pointer input, and direct pointer interaction with that browser surface should focus the webview before the guest handles input
- transparent or partially transparent remote pages should reveal a browser-default white backing inside the content shell rather than the modal's dark chrome
- desktop `_blank` and `window.open(...)` behavior must stay in-app: the injected runtime should emit `open_window` bridge events so the renderer opens a fresh `browser-N` modal instead of allowing a separate OS window
- the injected-side runtime must register a `ping` request handler that responds with the exact string `received:<payload>` for smoke testing from the host helper
- the injected-side runtime must also register a `dom` request handler; when called with no selectors it must return `{ document: "<serialized html>" }`, and when called with `{ selectors: [...] }` it must return an object whose keys are the original selector strings and whose values are the concatenated matched `outerHTML` strings for each selector
- the injected-side runtime must also register `navigation_state_get`, `location_navigate`, `history_back`, `history_forward`, and `location_reload` request handlers, and it must emit `navigation_state` events whenever the current frame URL changes or a new page finishes loading so the host toolbar can stay in sync
- the injected-side runtime must stay transport-agnostic inside the page: it should use iframe `postMessage` when no desktop bridge exists and should switch to the desktop preload transport when `__spaceBrowserEmbedTransport__` is present, so later browser-extension injection can reuse the same page-side request handlers
- normal browser sessions must still leave the file named by `data-space-inject` inactive until a non-desktop browser-side injector exists
- the placeholder frame should keep a dark background, centered red engineer full-body artwork from `/mod/_core/visual/res/engineer/astronaut_red_no_bg.png`, and the same slow floating motion language used by the first-party chat and launcher astronaut treatments, with the exact text `Browser currently only works in native apps and is under development.`

## Development Guidance

- keep browser-overlay behavior self-contained here unless a stable menu or router seam changes
- prefer extending this module's store and component pair over adding ad hoc globals or shell patches
- keep the browser surface generic enough that later browsing logic can replace only the inner browsing engine or injection transport without rewriting the floating-window chrome
- if the overlay seam, menu-item order, browser id scheme, `<x-browser>` contract, toolbar contract, injected-runtime transport, `data-space-inject` contract, packaged-desktop browser bridge rules, or browser-frame bridge envelope or message types change, update this file, `/app/AGENTS.md`, `/packaging/AGENTS.md`, and the matching docs under `_core/documentation/docs/`
