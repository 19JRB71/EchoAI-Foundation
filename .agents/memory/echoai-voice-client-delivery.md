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

## Rule: owner-only voice UI is gated in 3 client places, mirroring backend
The voice APIs are owner/admin-only (`auth + lockout + requireOwner`). The client
must mirror this: add the section to the `canOpenSection` owner/admin predicate
(this both hides the Echo department tool via DepartmentView filtering AND guards
the section render), or a team member hits a 403 that looks like a bug.
