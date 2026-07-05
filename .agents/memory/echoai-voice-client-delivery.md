---
name: EchoAI voice client delivery/dedup
description: How the client voice queue must dedup polled notifications and settle terminal status so nothing is silently dropped or replayed.
---

# EchoAI voice client notification delivery

The client voice engine polls `GET /api/echo-voice/pending` and speaks a queue.

## Rule: dedup against a terminal set + the live queue, never a permanent "seen" set
**Why:** A permanent `seen` set (add on enqueue) permanently suppresses any item
whose playback was blocked (browser autoplay) or stopped/muted mid-flight — the
server row stays `pending` but the client never re-serves it, so the reminder is
lost for the whole session.
**How to apply:** Keep a `deliveredIds` set that only receives an id on a TRUE
terminal outcome (spoken → server `delivered`; user skip → server `dismissed`).
At poll time, dedup new ids against `deliveredIds` PLUS whatever is currently in
the queue / playing. Blocked/stopped/errored items never become terminal, so
they naturally re-enqueue on a later tick.

## Rule: settle terminal server-status centrally in the drain loop, not in skip()
**Why:** Marking "delivered" inside `skip()` conflates "spoken" with "user
dismissed" and races the in-flight TTS. Centralizing it keeps semantics correct:
`played → delivered`, `skipped → dismissed`, blocked/stopped/error → nothing.

## Rule: guard playback after the TTS await
**Why:** `skip()`/`stopAll()` can resolve the in-flight speak promise while the
TTS fetch is still pending; without an `if (settled) return;` after the await, a
new `Audio` element is created and plays AFTER the stop, leaking the element and
object URL.

## Rule: autoplay-gated items must be re-queued and resumed on a user gesture
**Why:** The morning briefing is enqueued right after login, before any click in
the freshly-mounted dashboard, and it plays *after* an `await` for the briefing
fetch — so the login gesture is already consumed and the browser blocks
`Audio.play()` (status `blocked`). The user gets no greeting at all. Worse, the
briefing has no `notificationId`, so the poll never re-serves it — once blocked it
was gone for the session.
**How to apply:** On `blocked`, `unshift` the item back to the front of the queue
(don't drop it) and set a `needsGesture` flag. A one-shot document
`pointerdown`/`keydown` listener (gated on `needsGesture && active`) flips the flag
off and re-drains, so the first interaction anywhere plays the pending briefing.
Surface a small "click anywhere to hear Echo" hint. Reset the flag on deactivate.

## Rule: chunk long TTS scripts + prefetch so first audio plays in ~1-2s
**Why:** Synthesizing a whole briefing (~570 chars) as one blob is ~11s of OpenAI
TTS + a ~700KB download before a single word plays — the user perceives a
20-30s dead wait after login.
**How to apply:** Split the script into sentence-grouped chunks (first chunk kept
small, e.g. <=120 chars) and play them sequentially with a ONE-chunk lookahead:
kick off the next chunk's synthesis the moment the current chunk *starts* playing
so TTS overlaps playback and there are no gaps. Keep all of this INSIDE `speakItem`
so the briefing stays a single queue item — skip/replay/stopAll/mute and the
autoplay-gesture gate keep working unchanged. `settle()` must force-resolve the
in-flight chunk's playback promise (a `chunkDone` resolver) so an interrupt unwinds
the awaited chunk; revoke each chunk's object URL as you advance; a mid-chunk error
is skipped gracefully; a first-chunk autoplay `blocked` re-queues the whole item.

## Rule: owner-only voice UI is gated in 3 client places, mirroring backend
The voice APIs are owner/admin-only (`auth + lockout + requireOwner`). The client
must mirror this: add the section to the `canOpenSection` owner/admin predicate
(this both hides the Echo department tool via DepartmentView filtering AND guards
the section render), or a team member hits a 403 that looks like a bug.
