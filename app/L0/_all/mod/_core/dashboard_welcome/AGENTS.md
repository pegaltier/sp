# AGENTS

## Purpose

`_core/dashboard_welcome/` owns the dashboard-injected welcome surface.

It renders the dismissible welcome panel at the top of the dashboard, persists the user's hide or show preference under `~/conf/`, and ships first-party demo-space folders that can be cloned into the authenticated user's `~/spaces/` root.

Documentation is top priority for this module. After any change under `_core/dashboard_welcome/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `dashboard-welcome.html`, `dashboard-welcome.js`, and `dashboard-welcome.css`: the injected welcome UI, preference loading and saving, and demo-space launch actions
- `ext/html/_core/dashboard/content_start/dashboard-welcome.html`: thin dashboard extension adapter for the welcome surface
- `examples/`: bundled demo-space folders copied into the user's writable spaces area on demand

## Local Contracts

Current dashboard integration:

- `_core/dashboard/` provides the `_core/dashboard/content_start` seam
- this module injects the welcome panel through that seam and should remain above the spaces list
- the welcome surface should stay optional and user-dismissable without affecting the rest of the dashboard
- the dismiss control should be a compact circular icon button aligned to the panel edge within the dashboard gutter, with local sizing rules strong enough to override shared `secondary-button` chrome, and demo-card icons should read as oversized clipped background motifs at low opacity with a slight glassy blur and the glyph itself explicitly oversized, not as inline badges
- demo-card title, icon, and icon color should load from each bundled example's own `space.yaml` so the dashboard preview matches the installed space metadata instead of relying on separate hardcoded presentation values

Current persistence and demo-space contract:

- the hide or show preference is stored in `~/conf/dashboard.yaml`
- the only persisted setting currently owned here is whether the welcome panel is hidden
- bundled demo spaces live under this module's `examples/` folder and are copied through the spaces runtime instead of being edited in place
- bundled demo `space.yaml` files should own the icon and color shown in the welcome cards, and installing a demo should preserve those values into the created user space
- welcome actions should call the public `space.spaces.installExampleSpace(...)` runtime helper rather than duplicating filesystem logic locally
- demo installs launched from the dashboard should push a new space route entry instead of replacing the dashboard route, so browser Back returns to the dashboard rather than exposing whatever older space happened to be behind it in history

## Development Guidance

- keep the copy brief, direct, and product-relevant
- keep the welcome surface visually lighter than the spaces grid below it
- if the preference path, extension seam, or example-space loading contract changes, update this file and the owning parent docs
