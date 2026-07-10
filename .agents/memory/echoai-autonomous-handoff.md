---
name: EchoAI autonomous conversation handoff & escalation-once
description: Two invariants for the two-way autonomous conversation engine — transferred-state silence and single-fire owner escalation.
---

# Autonomous conversation: owner handoff must silence the bot; escalate exactly once

## Rule 1 — the "open conversation" lookup must include `transferred`, not just the active states
When an inbound lead reply drives the engine, the get-or-create step decides
whether to reuse an existing thread or start a fresh `active` one. The
concurrency-safe create uses a **partial unique index over only the open
statuses** (`active`, `awaiting_owner`). A `transferred` conversation is NOT in
that partial index, so if the initial lookup also filters to only those open
statuses, the transferred row is invisible → a brand-new `active` thread is
inserted and Echo resumes auto-replying after the owner already took over.

**Fix pattern:** the lookup SELECT must include `transferred` (ordered so
transferred wins if a legacy duplicate exists) so the caller's
`status === 'transferred'` short-circuit actually fires and the bot stays silent
until an explicit resume.

**Why:** transfer = human took over; the whole point is Echo goes quiet. A
lookup scoped to the create-index's status set silently breaks the handoff.

## Rule 2 — "alert owner once" must be an atomic compare-and-set, not a stale-read boolean
A once-per-conversation owner escalation (voice+SMS on a hot buying signal) is
NOT safe if you decide it from a pre-read (`!row.owner_alerted_at`) and fold the
stamp into a broader multi-column UPDATE without an `IS NULL` predicate. Two
concurrent buying-signal turns both read null, both stamp, both alert → duplicate
owner SMS.

**Fix pattern:** run a dedicated CAS — `UPDATE ... SET owner_alerted_at = NOW()
WHERE id = $1 AND owner_alerted_at IS NULL AND status IN (open)` — and only fire
the alert when it RETURNs a row. Keep the per-turn transcript/status UPDATE
separate. Also skip escalation on a terminal turn (booked/converted/stopped) —
a handoff offer is moot once the lead closed.

**Why:** the alert side-effect (SMS/voice) can't be deduped after the fact;
single-winner emission must be enforced by the DB write, not app-level state.

**How to apply:** any "notify once per row" side-effect gated on a nullable
timestamp/flag column — use the CAS-returns-a-row test, never a stale read.
