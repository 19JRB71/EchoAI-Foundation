---
name: EchoAI admin status-refresh merge
description: Shared admin action helpers that setStatus(response) must MERGE partial payloads, not replace, or partial-payload endpoints wipe unrelated state.
---

# Admin panels: merge partial responses into status, never replace

Admin panels (e.g. AdminDemo) use one shared action helper (`run(label, fn)`)
that stores the endpoint response into a single `status` object. Several
endpoints return only a PARTIAL payload (e.g. the demo `.../suggestions/adapt`
returns just `{ scenario, hasCustomSuggestions, suggestions }`, not the full
status). A blind `setStatus(data)` then drops fields like `seeded`/`active`/
`demoBrandId`, silently breaking the Presentation-Mode controls until reload.

**Rule:** merge — `setStatus(prev => ({ ...prev, ...data }))`. Full-status
responses still fully populate; partial ones only patch what they carry.

**Why:** a full-replace looked correct because most endpoints happen to return
full status; the one partial-return endpoint (adapt) caused a state-loss
regression that only shows after that specific action.

**How to apply:** any time a single state object is refreshed from multiple
endpoints with differing response shapes, merge. Only replace when every
contributing endpoint is guaranteed to return the complete object.
