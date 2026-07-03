---
name: EchoAI large base64 uploads
description: How endpoints that accept base64 image/screenshot data URLs must handle the JSON body-size limit.
---

# EchoAI base64 upload endpoints and the JSON body limit

Any EchoAI endpoint that accepts a base64 data URL (screenshots, images) must
get a **scoped** larger JSON body limit — do NOT raise the global limit.

**Why:** `server.js` parses bodies with `express.json()` at its **default 100 KB
limit**. Real screenshots/images (even downscaled) blow past that, so the request
is rejected during body parsing before any controller/auth runs. Raising the
limit globally would widen the DoS surface for every other endpoint.

**How to apply:** mirror the Stripe raw-body pattern — the global body-parser
middleware skips the specific POST paths (a `Set` of exact `req.path`s), and each
of those routes mounts its own `express.json({ limit: "12mb" })` in its router.
12mb covers an 8 MB decoded image (base64 inflates ~33%). Controller still
enforces its own decoded-byte cap and returns 413 when the buffer is too large.
Verify with a >100 KB curl payload to the scoped route (parses) vs a normal route
(still 413).
