-- 102_sage_feed_content_unique.sql
-- Make the Latest Intelligence content dedup atomic: enforce at the database
-- level that a brand can only ever have ONE VISIBLE feed row per content_key,
-- so two concurrent research writers (deep + urgent cycles run independently)
-- can never both insert the same finding under different signal_keys.
--
-- Partial index (visible rows only) because dismissed rows legitimately share
-- a content_key with the visible row that replaced older duplicates in 101.
-- The app-code insert catches unique_violation (23505) and treats it as an
-- already-saved dedup no-op.

-- Safety re-run of 101's cleanup in case duplicates slipped in between the two
-- migrations: keep only the newest visible row per (brand, content_key).
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
        WHERE dismissed_at IS NULL AND content_key IS NOT NULL
     ) ranked
     WHERE ranked.rn > 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_feed_content_visible
  ON sage_intelligence_feed (brand_id, content_key)
  WHERE dismissed_at IS NULL AND content_key IS NOT NULL;
