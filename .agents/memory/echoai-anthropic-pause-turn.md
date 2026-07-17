---
name: EchoAI Anthropic web-search pause_turn
description: Anthropic server-tool (web_search) turns can end with stop_reason pause_turn and MUST be continued, or JSON extraction fails.
---

**Rule:** Any Anthropic call using a server tool (web_search) can return
`stop_reason: "pause_turn"` with a partial turn. The caller must append the
response content as an assistant message and re-call until the turn completes
(bounded rounds). This is handled centrally in the `createMessage` wrapper —
never add per-feature workarounds.

**Why:** Sage's Company Truth report failed repeatedly in production with
"could not complete the company research": the paused partial response reached
the JSON extractor, which threw aiInvalid. Intermittent-looking but really a
missing protocol step.

**How to apply:** Web-search-tool features (Sage research, pattern
intelligence, company truth) just call `createMessage`. When adding a new AI
wrapper or streaming path with server tools, replicate the pause_turn loop.
Also include `stop_reason` in aiInvalid error messages — it distinguishes
truncation (max_tokens) from pause_turn from genuine bad output.
