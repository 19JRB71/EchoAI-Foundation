---
name: EchoAI runtime client config
description: Why client env config must be fetched at runtime, not baked in via VITE_* vars
---

The SPA bundle is prebuilt locally and committed (`client/dist`); Railway serves
it as-is (nixpacks skips the client build). Therefore **no `VITE_*` env var set
on Railway can ever reach the client bundle**, and one committed bundle must
serve both staging (test keys) and production (live keys).

**Rule:** any environment-dependent client config (Stripe publishable key, etc.)
must be fetched at runtime from a public no-auth server endpoint (pattern:
`GET /api/subscriptions/config` → `{ publishableKey }`, resolved in
`client/src/lib/stripe.js` with a cached singleton + `useStripePromise()` hook).
A build-time VITE key still wins if present (local dev convenience only).

**Why:** staging smoke test surfaced "Payments are not configured" because the
key was baked in at build time and absent from the committed bundle.

**How to apply:** never add a new `VITE_*` var expecting deploy-time values;
add a public config endpoint instead. Cache failure handling: a transient fetch
failure must NOT be cached (sticky null until reload) — clear the singleton so
the next caller retries; only a successful "no key configured" answer is cached.
