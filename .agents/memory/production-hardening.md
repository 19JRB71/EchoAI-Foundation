---
name: EchoAI production hardening (CORS, rate limit, errors, migrations)
description: Conventions for the production middleware stack and migration runner in the EchoAI Express server
---

# EchoAI production hardening

The EchoAI Express server (`EchoAI/server.js`, CommonJS, single-origin API+SPA)
applies a production middleware stack. Durable rules to keep consistent:

- **Stripe webhook raw body:** the JSON-parser-bypass for
  `/api/subscriptions/webhook` must match on `req.method === "POST" &&
  req.path === "/api/subscriptions/webhook"` — NOT `req.originalUrl` equality.
  **Why:** query params / trailing slash on `originalUrl` would let
  `express.json()` consume the body and break Stripe signature verification.

- **Rate limiter** is mounted `app.use("/api", limiter)`, so inside the limiter
  `req.path` is already stripped of the `/api` prefix — the webhook `skip` test
  is `req.path === "/subscriptions/webhook"` (no `/api`). Don't "fix" it to
  include `/api`.

- **Malformed-JSON detection** in the global error handler must be
  parser-specific (`err.type === "entity.parse.failed"` or `err.status === 400
  && "body" in err`), NOT a broad `err instanceof SyntaxError`. **Why:** a broad
  check misreports unrelated server-side SyntaxErrors as client 400s.

- **CORS** is permissive in dev (the preview/canvas iframe is cross-origin) and
  restricted in production to `https://`+`REPLIT_DOMAINS` plus `ALLOWED_ORIGINS`.
  Requests with no `Origin` (same-origin / non-browser) are always allowed —
  required because the SPA and API share one origin.

- **Migration runner** (`utils/runMigrations.js`, `npm run migrate`) relies on
  every `models/*.sql` being idempotent (`IF NOT EXISTS`). It tracks applied
  files in `schema_migrations` and **fails hard** on a real error rather than
  baselining-on-duplicate. **Why:** silently marking a file applied after one
  duplicate-object error can skip later new statements → schema drift.

- **Env validation** (`config/env.js`, called at boot) throws on missing
  critical vars (DATABASE_URL, JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY) and
  only warns for feature vars (feature degrades to 503 / "not configured").

**How to apply:** when adding routes/integrations, keep new optional config
feature-gated (warn + 503), keep new raw-body needs out of the JSON bypass
unless matched by path+method, and keep migrations idempotent.
