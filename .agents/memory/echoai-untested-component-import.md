---
name: EchoAI untested-component import trap
description: Why a broken import in a new client component passes client-test but fails the build
---

A new client component that no test file imports can ship a wrong import
(e.g. `import api from "../api"` when api.js only has a **named** export) and
`client-test` (vitest) will stay green — vitest only resolves modules it
actually loads. The error surfaces **only** at `npm run build` (rollup:
`"default" is not exported by ... imported by <component>`).

**Why:** api.js exports `export const api = ...` (named only, no default).
Components must use `import { api } from "../api"`.

**How to apply:** after adding any new client component, always run the client
build (`cd EchoAI/client && npm run build`) — a passing client-test does NOT
prove the new component compiles.
