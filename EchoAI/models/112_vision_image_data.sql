-- Vision reference photos: store the image bytes IN the database so uploads
-- survive redeploys. Production (Railway) has an ephemeral filesystem — every
-- deploy wipes uploads/vision/, which orphaned the DB rows (broken thumbnails,
-- photo-based Autopilot items silently downgrading to AI originals).
-- The disk copy becomes a cache that is restored from this column on demand.

ALTER TABLE vision_reference_images
  ADD COLUMN IF NOT EXISTS image_data BYTEA;
