---
name: EchoAI voice engine hardening
description: Cancellation/timeout pattern for the always-on voice conversation engine — why Echo went deaf or spoke stale replies, and the invariants that prevent it.
---

# Voice engine hardening (conversation engine)

Rule set: every awaited network/AI call inside the voice command pipeline must be
(a) time-boxed and (b) generation-guarded.

- **Timeouts**: wrap every awaited fetch/AI call in `withTimeout` (exported from
  conversationHelpers). A single hung promise used to leave the engine suspended
  (deaf) forever — the #1 "Echo ignores me" cause.
- **Generation counter**: the command pipeline bumps a `cmdGenRef` at entry and
  captures a local `stale()` closure; insert `if (stale()) return;` after EVERY
  await (fetch, AI handler, and speak) before speaking or reopening follow-up
  windows. Interrupt ("Stop") and the watchdog also bump the gen — that is what
  cancels in-flight commands and kills stale late replies / random talk.
- **Barge-in must match while processing too**, not just while audio plays:
  condition is `(speaking || suspended) && !interrupted`. Otherwise "Stop" is
  ignored during the thinking phase.
- **Auto-speech unlock** (`echoai:user-initiated`) fires only on a real
  non-empty command inside processCommand — never on a bare wake-word match, or
  a false wake unleashes the weekly briefing + pending alerts.
- **Stuck-suspend watchdog**: 5s interval; suspended with no audio playing for
  60s straight → bump gen, clear timers/pending, force passive. Belt-and-braces
  so the mic can never silently stay dead even if a path misses a guard.

**Why:** these four failure modes (deaf hang, stale reply spoken late, Stop
ignored while thinking, false-wake auto speech) each read to the owner as
"Echo is broken / talks randomly". Any new awaited call added to the pipeline
must follow the same withTimeout + stale() pattern.
