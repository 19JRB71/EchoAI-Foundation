---
name: EchoAI morning voice briefing
description: Login standby greeting, user-initiated briefing delivery, and the empty-account welcome
---

# Morning voice flow (standby greeting → user-initiated briefing)

## Standby, never auto-play (owner requirement)
- Echo must NEVER auto-start the morning briefing. On login he speaks exactly
  "Good morning Sir. I will be on standby waiting for you to start your morning briefing."
  then goes quiet. The briefing plays only when the owner asks ("Hey Echo start my briefing",
  "ready", "run it", "let's go", "what's good", any briefing request).
- The go-ahead matcher accepts short affirmative barks (≤4 words) but never a "yes" buried in a longer sentence, and NO-phrases always win.
- The standby flag lives in the conversation engine and deliberately survives mic mute/soft-close so a later "Hey Echo, start my briefing" still works; it clears only when the briefing is actually delivered.
- **Delivered-stamp honesty:** `markBriefingDelivered` fires only when playback truly completed — speakAndWait resolves `true` only on real onPlayed, `false` on muted/blocked/timeout, and a non-played briefing keeps standby set.

## Fire-on-every-login guard
- The standby greeting speaks on **every login** (owner preference), regardless of `alreadyDeliveredToday` — it never replays the briefing itself.
- Reload-vs-login distinction is a **token-scoped** sessionStorage guard key (`echoai_briefing_<jwt-tail>`), NOT a fixed key.
  - **Why:** a fixed-key guard cleared only in the `active=false` teardown effect fails — on logout the authed subtree unmounts, the cleanup never runs, and the key suppresses the next login's greeting.
  - **How to apply:** a fresh login mints a new JWT → new key absent → greeting plays; a bare reload keeps token+sessionStorage → suppressed.

## Empty-account welcome content
- `hasActivity(data)` decides empty state; empty → warm welcome + Facebook-connect nudge instead of "No new leads…".
- Empty copy drops the FB sentence when Facebook is already connected; the AI narration branch also never recites zero counts, with a tight time budget then template fallback so speech starts fast.
