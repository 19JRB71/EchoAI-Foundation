---
name: Social connect endpoint 502 contract
description: Why POST /api/social/connect returns 502 on stored-but-unverified credentials and how clients must handle it
---

`POST /api/social/connect` persists the (encrypted) credentials first, then
verifies them against the platform. When verification fails it still keeps the
row (with `connection_status = 'error'`) and responds **502** with a body of
`{ account, warning }` — there is no `error` field, so a generic fetch wrapper
will surface "Request failed (502)".

**Why:** storing-then-verifying lets the user retry/fix a bad token without
re-entering everything, and a non-2xx status signals the connection isn't usable
yet. The trade-off is that 502 is NOT a true failure here — the account exists.

**How to apply:** any client wiring the connect flow must treat `err.status ===
502` as "stored but needs attention" (reload the accounts list so the row shows,
typically with an amber badge), not as a no-op failure. The shared `api.js`
wrapper attaches the parsed body as `err.data`, so `err.data.warning` is
available if you want to show the reason.
