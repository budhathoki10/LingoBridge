# Brand assets

The LingoBridge mark, exported for use outside the app (README headers, the
Chrome Web Store listing, sharing with collaborators).

- `logo.svg` — the source of truth. `packages/design-tokens/logo.svg` and every
  in-app icon (the extension's `apps/extension/assets/icon.svg`, the
  dashboard's favicon) are copies of this same file, so changing the mark
  means updating all of them together.
- `logo-128.png`, `logo-256.png`, `logo-512.png`, `logo-1024.png` — rasterized
  exports for contexts that need a plain PNG rather than a vector.

For the extension's actual packaged icon (what Chrome shows in the toolbar
and `chrome://extensions`), use `apps/extension/public/icon/128.png` instead
of the copy here — it's the file the build produces and ships, kept in sync
with `scripts/generate-icons.mjs`.
