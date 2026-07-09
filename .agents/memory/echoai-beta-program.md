---
name: EchoAI Beta Program
description: Beta slot cap + waitlist + activity tracking design rules
---

- **Slot rule**: a used beta slot = `is_beta AND role='user' AND NOT locked`. Locking frees the slot; Convert-to-Paid clears `is_beta`. Keep every capacity read on this one predicate (`countUsedSlots`), never re-derive it inline.
- **Cap enforcement lives in register()**, not the signup-mode hint: `SELECT ... FOR UPDATE` on the `beta_settings` singleton serializes concurrent signups; full → 403 `{waitlistOpen:true}`. `GET /signup-mode` is a fail-open hint only (capacity probe errors must not block signup attempts).
- **Warning/waitlist emails are claim-then-send with revert**: atomically claim rows (set `beta_warning_sent_at`/`notified_at`), send, and revert the claim on email failure so the next daily run retries — never send-then-mark (double emails) or mark-without-revert (lost warnings).
- **Feature tracking is fire-and-forget from auth middleware** with an in-memory 10-min throttle per user+feature and an UNTRACKED mount set (auth/admin/public/v2/webhooks-inbound). Login recovery clears `beta_warning_sent_at`.

**Why:** capacity and email sweeps race with concurrent signups/ticks; these seams keep the cap exact and emails exactly-once-per-eligibility.
**How to apply:** any change to beta capacity, lock/convert flows, or the daily sweep must preserve the single slot predicate and the claim/revert pattern.
