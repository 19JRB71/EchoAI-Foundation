---
name: EchoAI failed-post reschedule
description: Invariants for putting a failed social post back on the schedule; marker-text coupling for interrupted publishes.
---

# Failed-post reschedule invariants

- Only the `failed -> scheduled` transition is allowed (atomic UPDATE with
  `status='failed'` in the WHERE + brands-join ownership; branch on row count,
  then a follow-up existence check decides 404 vs 409). Never re-queue a
  `published`/`publishing` post — double-post risk.
- Rescheduling clears `engagement_metrics` (that's where the failure reason
  lives) in the same UPDATE.

**Marker-text coupling (the non-obvious part):** the scheduler's stale-publish
rescue sweep stores the phrase "may or may not have gone out" in
`engagement_metrics.error`, and the client's `isInterruptedPublish()`
(`client/src/sections/social/postFailure.js`) regex-matches that phrase to
demand an explicit double-post confirmation checkbox before allowing a
reschedule.

**Why:** an interrupted publish may already be live on the platform;
rescheduling without the warning can silently double-post.

**How to apply:** if the rescue sweep's error copy is ever reworded, update the
client matcher in lockstep (and its tests), or the double-post confirmation
silently disappears.

## Same pattern reused for email/SMS one-tap retries

- Email drip: failed recipient -> pending is one atomic UPDATE (brands-join
  ownership, `delivery_status='failed'` guard, resets `send_attempts=0` and
  `next_send_at=NOW()` in the same statement); next hourly drip tick resends.
- SMS blast retry: the atomic `failed -> sending` claim MUST happen BEFORE
  re-queueing the failed messages — sendCampaign claims from
  `('draft','failed')`, so re-queueing first would let a concurrent send pick
  up the rows. Only `delivery_status='failed'` outbound rows are re-queued
  (sent rows never re-text). The final flip recomputes `delivered_count` from
  the messages table, not this run's counter, so retries don't clobber totals.
