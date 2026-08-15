---
name: EchoAI volunteered-URL confirmation (035-C2)
description: Embedded-URL detect→confirm→capture flow in the setup interview; key invariants and traps.
---
- Detection ≠ capture: embedded URLs queue in `answers._interview.urlConfirm` (JSONB, no schema) and are captured ONLY on explicit owner YES via the same `applyOnlinePresence → onAnchorArrival(reason "setup_interview")` chain as the whole-answer path. Sentinel target `_c2_url_confirm` is deliberately NOT a knowledge FIELD_KEY.
- **Trap:** `applyOnlinePresence` returns true whenever presence aliases are PRESENT, not when values changed — so the C1 mid-interview handoff re-fires `onAnchorArrival` on later turns. "No duplicate research" is enforced downstream by the unmodified `sameAnchors` dedup; never assert arrival-count==1 across turns.
- Canonical URL form is the normalizer's `url.href` (root URLs carry a trailing "/"); compare tests against normalized values, not raw input.
- AM rules: beyond-cap (3) candidates never enter the decided map (re-volunteer stays eligible); confirmation exchanges keep a bounded exchangeLog; a later whole-answer URL overrides a prior embedded rejection; ambiguous replies re-ask once then fail closed.
**Why:** the Section-P smoke showed Echo verbally acknowledging a volunteered URL that was never structurally captured; C2 fixed capture while keeping honesty (no "saved" wording before structured capture).
**How to apply:** any future edits to the setup interview URL paths or their tests.
