---
name: EchoAI SPA cache headers (stale bundle)
description: Why index.html must be served no-cache, or newly-shipped client features silently never load in the browser.
---

# EchoAI stale-bundle gotcha

EchoAI serves the prebuilt Vite SPA from `client/dist` via `express.static` +
an SPA fallback `sendFile(index.html)`.

## Symptom
A newly-shipped client feature "does nothing" in the browser even though the
build is correct: e.g. the dashboard renders and login works, but the feature's
API endpoints are NEVER hit (no requests in the server log at all). The built
`dist` clearly contains the new code (grep confirms), yet the browser doesn't run
it.

## Cause
The browser is running a **stale cached bundle**. Vite hashes JS/CSS filenames,
so the only file that points at the current bundle is `index.html`. If
`index.html` is cacheable, the browser keeps loading the OLD hashed JS — which
has the old dashboard/login but not the new provider/feature — so its effects
never fire and no new endpoints are called.

## Fix / invariant
Serve `index.html` with `Cache-Control: no-cache` (always revalidate) and let
hashed `assets/*` be `immutable, max-age=31536000`. Applied in BOTH places that
emit the entry document: the `express.static` `setHeaders` hook AND the SPA
fallback `sendFile`. Verify with `curl -sI localhost:80/` (expect no-cache) and
`curl -sI localhost:80/assets/index-<hash>.js` (expect immutable).

## Operational note
A cache-header fix does NOT refresh an already-open tab — that tab still holds the
old bundle. The user must hard-refresh once; after that, future deploys are
picked up automatically because index.html is always revalidated.

## The bigger trap: the PWA service worker (this is usually the real cause)
EchoAI is an installable PWA. `client/public/sw.js` registers on every load
(`main.jsx` → `registerServiceWorker()`) and **answers from its own Cache Storage
first — HTTP `Cache-Control` headers are irrelevant to what it serves.** It
precaches the app shell (`/`, `/dashboard`) into a named cache and its `activate`
handler deletes only caches whose name != the current `CACHE` constant.

**Failure mode:** the `CACHE` name is a static string (e.g. `echoai-shell-v1`).
If it never changes, the old precached shell + old hashed bundle live in Cache
Storage forever, so a returning PWA user is served the pre-feature bundle across
reloads no matter what the server sends. New client features "do nothing" and
their endpoints never appear in the log — identical symptom to the HTTP-cache
stale bundle, but headers won't fix it.

**Fix / release ritual:** bump the `CACHE` version string in `sw.js` on any
release that must invalidate the shell. The `activate` cleanup then deletes the
old cache; with `skipWaiting()` + `clients.claim()` the new SW takes over. It can
take up to two reloads (reload 1 installs/activates the new SW and purges the old
cache; reload 2 fetches the fresh shell). Verify the served worker with
`curl -s localhost:80/sw.js | rg echoai-shell-v`.

**Why:** the service worker is a caching layer ABOVE the HTTP cache; a
server-only header change can look correct in `curl` yet never reach a PWA user.
