---
name: PWA service worker + static assets must live in client/public, not src
description: Where to put sw.js / manifest / icons in a Vite SPA served single-origin by Express
---

# PWA service worker & manifest belong in `client/public/`, not `client/src/`

In a Vite SPA, the service worker (`sw.js`), `manifest.json`, and PWA icons must
go in `client/public/` so Vite copies them verbatim to `dist/` and they are
served at the **site root**.

**Why:** a service worker only controls the scope it is served from. To control
the whole app (scope `/`) it must be reachable at `/sw.js`. If it lives in
`src/`, the bundler hashes/relocates it and its scope is wrong, so it silently
fails to control navigations. The manifest/icons likewise need stable root URLs
the HTML can reference.

**How to apply:** put `sw.js`, `manifest.json`, and icons in `client/public/`.
Register the SW with `${import.meta.env.BASE_URL}sw.js` and scope `BASE_URL`.
If an Express server has an SPA catch-all, make sure it skips asset-like paths
(EchoAI's fallback skips any path containing `.`), so `/sw.js` etc. are served as
static files instead of returning index.html. Build-time icon generation: this
environment has ImageMagick (`magick`/`convert`) to rasterize an SVG into PNGs.
Split SW *registration* (run on every load) from push *subscription* (run on
first login) — they are different lifecycle moments.
