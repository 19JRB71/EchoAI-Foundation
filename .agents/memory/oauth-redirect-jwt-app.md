---
name: OAuth redirect flows in a JWT (header-auth) SPA
description: How to authenticate an OAuth initiate/callback round-trip when the app uses bearer-JWT auth, not cookies
---

# OAuth redirect round-trips in a JWT-auth SPA (EchoAI Facebook connect)

The app authenticates API calls with a bearer JWT in the `Authorization`
header (localStorage), NOT cookies. OAuth requires top-level browser
navigations (to the provider, then a provider→callback redirect) that cannot
carry that header. The correct pattern:

1. **initiate = authenticated POST** (Authorization header) that creates a
   random CSRF `state`, stores `{state, userId}` server-side in a **session**,
   and **returns the provider auth URL**. The client then does
   `window.location = authUrl`.
2. **callback = unauthenticated GET** (it's the provider's top-level redirect)
   that reads `state`+`userId` from the **session** cookie and verifies state.

**Why not `GET /initiate?token=<jwt>` that 302s to the provider?** Putting the
bearer JWT in a URL leaks it via browser history, referer, and proxy/access
logs — it's a reusable credential → account takeover. The architect rates this
**High severity**. Always keep the JWT in the header.

**Session cookie settings that make the round-trip work behind the Replit
HTTPS proxy:** `app.set("trust proxy", 1)`; cookie `sameSite: "lax"` (Strict
would drop the cookie on the provider→callback top-level GET), `httpOnly`,
`secure` only in production. Call `req.session.save()` before responding so the
state is durable before the user navigates away. Use `connect-pg-simple` so
sessions survive restarts. **Fail boot if `SESSION_SECRET` is missing** — no
insecure fallback secret.

**How to apply:** any future provider OAuth (Google, LinkedIn, etc.) in this
JWT-auth app should reuse this initiate-POST / callback-GET + PG-session shape.
