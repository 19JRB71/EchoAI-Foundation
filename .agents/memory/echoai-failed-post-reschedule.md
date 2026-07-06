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
