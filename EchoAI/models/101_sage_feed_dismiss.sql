-- 101_sage_feed_dismiss.sql
-- Latest Intelligence cleanup: owners can delete (dismiss) feed items, and the
-- feed dedups on CONTENT as well as signal_key.
--
-- Why soft-dismiss instead of hard DELETE: Sage's recurring scans upsert on
-- (brand_id, signal_key). A hard-deleted row would simply be re-inserted on the
-- next cycle. Keeping the row with dismissed_at set makes the delete permanent:
-- the upsert sees the dismissed row and leaves it alone, and every reader
-- (feed, briefings, mission control, Sage context) filters dismissed rows out.
--
-- content_key: md5 of the normalized summary (lowercased, punctuation collapsed
-- to single spaces). Sage's AI sometimes re-finds the same story under a new
-- signal_key; the content key catches those repeats so the feed doesn't fill
-- with the same finding two or three times.

ALTER TABLE sage_intelligence_feed
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_key  TEXT;

-- Backfill content_key for existing rows using the same normalization the app
-- code applies (lower → non-alphanumeric runs to a single space → trim).
UPDATE sage_intelligence_feed
   SET content_key = md5(trim(regexp_replace(lower(summary), '[^a-z0-9]+', ' ', 'g')))
 WHERE content_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_sage_feed_content
  ON sage_intelligence_feed (brand_id, content_key);

-- One-time cleanup of the duplicates already sitting in the feed: for each
-- (brand, content_key) keep only the newest visible row and dismiss the rest.
UPDATE sage_intelligence_feed f
   SET dismissed_at = NOW()
 WHERE f.dismissed_at IS NULL
   AND f.feed_id IN (
     SELECT feed_id FROM (
       SELECT feed_id,
              ROW_NUMBER() OVER (
                PARTITION BY brand_id, content_key
                ORDER BY created_at DESC, feed_id
              ) AS rn
         FROM sage_intelligence_feed
        WHERE dismissed_at IS NULL
     ) ranked
     WHERE ranked.rn > 1
   );
