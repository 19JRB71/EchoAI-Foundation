---
name: EchoAI presentation-mode queue hold
description: Sales demo must hold proactive voice items, purge stale demo lines, survive reloads, and freeze auto-advance while autoplay is gesture-blocked.
---

# EchoAI presentation-mode voice-queue rules

Four durable rules learned from the "Good morning replayed mid-demo / demo
won't start until pause+play" bugs:

1. **Hold proactive items while a demo is live.** The drain loop's hold
   predicate must treat `presentationRef` like conversation-busy: proactive
   items (briefings, alerts, unknown types) stay queued for the whole demo and
   are released by a drain kicked off `echoai:demo-stop`. Demo item types
   (`demo`, `demo-suggestion`) must be in INTERACTIVE_TYPES or the demo holds
   its own narration.
2. **Purge superseded demo lines on every step change.** An autoplay-blocked
   line is re-queued at the queue front; without a `clearDemoQueue()` purge in
   `goToStep`, the stale opener replays later over a different step's screen.
3. **Every state flag driven by a window event needs a reload path.** App's
   demo rehydrate set React state but never dispatched an event, so the voice
   engine's presentation flag silently stayed off after refresh
   (`echoai:demo-resume` fixes it). Audit rehydrate paths for event-driven refs.
4. **Freeze auto-advance while `needsGesture` is true.** The fallback timer
   otherwise silently skips unheard steps before the first click unlocks
   audio; re-arm the (suggestion-aware) fallback when the gesture lands, and
   show the presenter a "click anywhere" banner.

**Why:** the voice queue outlives demo steps and page loads; anything queued
before/during a demo will eventually play unless explicitly held or purged.
