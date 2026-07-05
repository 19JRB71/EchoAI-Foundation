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
