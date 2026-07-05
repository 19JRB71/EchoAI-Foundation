---
name: EchoAI demo auto-advance
description: Driving automatic step progression from the Echo voice engine requires a fallback timer, not just onPlayed.
---

# EchoAI Presentation Mode auto-advance must not depend on onPlayed alone

The Echo voice engine's `enqueue({ onPlayed })` callback fires ONLY when a line
reaches natural completion (`status === "played"` in VoiceContext `drain`). It
does NOT fire when the item is muted (drain early-returns before speaking),
autoplay-blocked (`needsGesture`), skipped, stopped, or errors on the first
chunk.

**Why:** The fully-automated demo (PresenterOverlay) advances step→step. If
advancement chains solely off `onPlayed`, any of those degraded voice outcomes
freezes the demo mid-presentation — the opposite of "no manual clicking."

**How to apply:** Any feature that auto-advances off spoken-line completion must
also arm a deterministic fallback timer per step (estimated speech time + buffer;
a shorter fixed pace when muted / no line). Funnel every advance path through one
timer ref that clears before re-arming so exactly one hop fires per step, and
guard timer/callback bodies with a run-token + paused check so a superseded
step can't advance after a manual jump.
