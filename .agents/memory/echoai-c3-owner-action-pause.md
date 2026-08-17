---
name: EchoAI Setup Agent owner-action pauses
description: C3 pattern — owner_action_required pauses (config capture + launch authorization) in the setup runner and client.
---

**Rule:** Setup-step preconditions the OWNER must fix are returned as re-derived `{status:"owner_action_required", action:{code,...}}` pauses (200, never a durable failure, no VALIDATION_FAILED row, no retry button). Launch-class actions additionally need a digest-bound `confirm:{step,digest}` (sha256 over current server truth); mismatch re-pauses with `changed:true`; the client confirmRef is one-shot. Marked guard errors carry `err.ownerActionRequired/ownerActionCode/safeMessage` and classifyStepError checks the marker BEFORE billing/status heuristics — only authored safeMessage text may surface.

**Why:** Configuration must be mechanically separated from provider launch (double-launch and silent-write risk); raw provider/DB error text must never reach the browser.

**How to apply:** Any new setup step with an owner-fixable precondition or an externally-visible side effect follows this pause+confirm pattern; test digests via a between-review config change; stub launch controllers by monkeypatching module exports (property lookups at call time).
