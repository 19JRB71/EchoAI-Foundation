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

- **Never hard-drop speech during speak-cooldown / post-question gates.** Fast
  answers to Echo's own question arrive inside those windows; dropping them is
  the #1 "Echo asked and then ignored my answer" cause. Accept FINAL chunks
  during the gates and filter only genuine self-echo via `isSelfEcho(heard,
  recentEchoTexts)` (tail-of-last-12-words containment + ≥70% fuzzy overlap for
  ≥3-word captures; short "yes"/"no" always pass). Feed `recentEchoTextsRef`
  from the `tts-start` event's `detail.text` — never re-derive from queue state.
- **Bare wake word must always be acknowledged.** An empty-command wake match in
  active mode must play the wake SFX + a short spoken ack + open the follow-up
  window with timers. A silent "reopen active with no timers" branch parks the
  session forever and reads as 3-4 failed "Hey Echo" retries.
- **runningRef/micLive are NOT liveness.** A wedged SpeechRecognition session
  can stay "running" forever without firing onend — green chip, deaf mic.
  Heartbeat (`heartbeatAtRef`) on start + every recognizer event
  (audio/sound/speech/result/error); the 1s watchdog force-recycles any session
  with no heartbeat for 75s (past the engine's own ~60s cap). `stopRecognition`
  must null ALL lifecycle handlers before `abort()` (stop() fallback) so a
  late onend can't double-restart.

**Why:** these failure modes (deaf hang, stale reply spoken late, Stop
ignored while thinking, false-wake auto speech, dropped fast answers, silent
wake, zombie session) each read to the owner as "Echo is broken / ignores me".
Any new awaited call added to the pipeline must follow the same withTimeout +
stale() pattern; any new gate must self-echo-filter rather than drop.
