---
name: EchoAI OAuth conventions
description: Shared rules every third-party OAuth integration in EchoAI must follow (Facebook, Google, and future ones).
---

# EchoAI OAuth conventions

When adding a new third-party OAuth integration to the EchoAI backend, follow the
existing Facebook/Google pattern. These rules are not obvious from any single file.

- **Initiate is an authenticated POST, never a token-in-query GET redirect.** The
  client calls `/oauth/initiate` with the `Authorization` header, gets `{ authUrl }`
  back, then does a top-level `window.location` navigation.
  **Why:** putting the bearer JWT in a redirect URL leaks it via browser history,
  server logs, and the `Referer` header (architect flagged the query-token approach
  as High severity).

- **The callback is the only route with NO auth middleware** — it's the provider's
  top-level GET redirect, which carries no bearer token. It re-establishes identity
  from the CSRF `state` it stored in the session at initiate time.

- **Session (express-session + connect-pg-simple) is required** to carry the CSRF
  `state` + the initiating `userId` across the redirect round-trip. Cookie is
  `httpOnly`, `sameSite: "lax"` (so it survives the provider's top-level GET back),
  `secure` only in production.

- **Tokens are AES-256-GCM encrypted** (`utils/encryption.js`) before storage. Never
  return a token from any status/list endpoint — only connection metadata.

- **Offline-access guard (Google-specific, but generalize it):** a refresh token is
  only issued on first consent. On reconnect, preserve the existing one with
  `COALESCE(EXCLUDED.refresh_token_encrypted, existing)`. After the upsert, if NO
  refresh token ended up stored, mark `connection_status = 'error'` and redirect with
  a re-consent message — do NOT report `connected`, or every read fails ~1h later when
  the access token expires.
  **How to apply:** request `access_type=offline` + `prompt=consent`, then verify via
  `RETURNING refresh_token_encrypted` that one is actually present.

- **Config-gating:** when provider credentials are unset, `initiate` returns 503 and
  `status` returns `configured:false` so the client hides the button instead of
  opening a broken provider dialog. `redirect_uri` is derived from `REPLIT_DOMAINS`
  (prod) / `REPLIT_DEV_DOMAIN`, overridable via an env var.

- **Error mapping:** upstream provider failures → 502; not-connected → 400;
  not-configured → 503. Matches the AI-controller (`emailCampaignController`) 502 convention.
