# AGENTS

## Purpose

`_core/skillset/` owns first-party reusable onscreen-agent skill packs that depend on small browser helper scripts.

This module is not a routed UI surface. It exists to keep skill instructions short, stable, and maintainable by moving repeatable browser-side logic into ordinary importable module files.

Documentation is top priority for this module. After any change under `_core/skillset/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `screenshots.js`: browser screenshot helpers, lazy `html2canvas` loading, and the exported screenshot wrapper API
- `vendor/html2canvas.min.js` and `vendor/html2canvas.LICENSE`: vendored `html2canvas@1.4.1` browser bundle and license used by the screenshot helper
- `ext/skills/screenshots/SKILL.md`: the top-level onscreen skill for page or element screenshots

## Skill Helper Contract

- helper files in this module must stay importable through stable `/mod/_core/skillset/...` paths from skill instructions
- `screenshots.js` is browser-only and should keep its public API small and explicit
- `screenshots.js` lazy-loads the module-local vendored `html2canvas@1.4.1` bundle from `/mod/_core/skillset/vendor/html2canvas.min.js` on first use and reuses the loaded global afterward
- `takeScreenshot(options)` captures `document.body` by default, applies full-page-friendly defaults for body screenshots, and returns `{ canvas, blob, width, height, type, filename }`
- `screenshotBase64(options)` returns `{ base64, width, height, type, filename }`
- `screenshotDownload(filenameOrOptions, maybeOptions)` downloads the captured image and returns `{ downloaded: true, filename, width, height, type }`
- the screenshots skill should point agents at `/mod/_core/skillset/screenshots.js` instead of repeating the low-level `html2canvas` bootstrap inline

## Development Guidance

- keep helper APIs narrow, stable, and easy to call from one short execution block
- prefer module-local helpers over bloating `SKILL.md` with long scripts, but promote a helper into `_core/framework/` only when it becomes general frontend runtime infrastructure rather than skill-focused utility
- when a helper API changes, update the affected `SKILL.md` files in the same session
