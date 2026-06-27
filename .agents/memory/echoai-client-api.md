---
name: EchoAI client api.js body handling
description: How the EchoAI SPA's fetch wrapper serializes request bodies — avoid double-encoding.
---

# EchoAI client `api.js` request body

The `request(path, { method, body, auth })` wrapper in
`EchoAI/client/src/api.js` already does
`body: body !== undefined ? JSON.stringify(body) : undefined`.

**Rule:** pass a **plain object** as `body`. Never pre-`JSON.stringify` it in the
api method.

**Why:** pre-stringifying double-encodes the payload — Express receives a JSON
*string* instead of an object, so controller destructuring reads `undefined`
fields and returns 400/validation errors. Curl tests still pass (they post the
raw body correctly), so this bug only shows up through the dashboard UI — easy to
miss without a UI-driven test.

**How to apply:** when adding new api.js methods, mirror the existing ones
(`body: { brandId, ... }`), not `body: JSON.stringify({...})`.
