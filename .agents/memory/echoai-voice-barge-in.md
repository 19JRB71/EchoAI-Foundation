---
name: EchoAI voice barge-in interrupts
description: Rules for interrupting Echo mid-speech and the audio-queue drain race
---

**Rule 1 — barge-in matching:** While Echo speaks, the mic hears Echo's own voice. Interrupt commands ("stop", "wait", etc.) must match the ENTIRE normalized utterance (short, ≤5 words, exact regex), never substring-match, or Echo's sentences containing "stop"/"wait" self-interrupt. The barge-in check runs BEFORE the suspendRef/speakingRef early-returns in the recognition handler.

**Rule 2 — drain re-kick:** The voice queue drain loop breaks on "stopped" while still busy; anything enqueued during the unwind (e.g. the "Understood Sir" ack right after stopAll()) hits the busy guard and never plays until a ~90s safety timeout. The drain's finally block must re-kick itself when the queue is non-empty — guarded by muted/inactive AND a synchronously-set needsGesture ref (set before the blocked-branch break), or autoplay-blocked items spin forever.

**Rule 3 — pending-choice refs:** Any new "Echo asked a question, awaiting answer" ref (pendingBriefingChoiceRef etc.) must be cleared at EVERY conversation reset site: interrupt, mute intent, soft-close timeout, muteMic — not just on consume — or a later unrelated utterance gets misrouted as the answer.

**Why:** found via architect review after implementing mid-speech interrupts; the race and the stale-pending bug were both real and silent.
