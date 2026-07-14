---
name: Sage feed dismiss + content dedup
description: How the Latest Intelligence feed handles owner deletes and duplicate findings
---

Rule: feed items are soft-dismissed (dismissed_at), never hard-deleted, and dedup runs on TWO keys — the AI signal_key AND a content_key (md5 of normalized summary).

**Why:** Sage's recurring scans upsert by signal_key, so a hard DELETE gets re-inserted next cycle; and the AI re-finds the same story under fresh signal_keys, so signal-key dedup alone fills the feed with repeats.

**How to apply:**
- Every reader of sage_intelligence_feed (feed API, briefings, mission control, agent roster, snapshots, sageContext) must filter `dismissed_at IS NULL`. New readers must too.
- Content dedup is enforced atomically by a PARTIAL unique index on (brand_id, content_key) WHERE visible — dismissed rows legitimately share keys with visible rows, so a full unique index would fail. App insert catches 23505 as a dedup no-op (can't put two ON CONFLICT targets on one INSERT).
- The JS normalization in contentKeyOf must stay byte-identical to the SQL backfill expression (lower → non-alnum runs to single space → trim → md5); a test asserts parity.
- A re-found finding matching a dismissed row is a no-op — deleted stays deleted.
