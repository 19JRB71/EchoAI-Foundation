-- 106_vision_reference.sql
--
-- Vision Reference Library (Phase 2).
--
-- Owners upload REAL photos of their own products / completed work / style
-- examples. These are the most honest source Vision can have: the customer's
-- own images, provided deliberately. During each study run Claude actually
-- LOOKS at these photos (vision input) and learns real materials, proportions,
-- colors, and quality level so Forge's generated images match the real
-- business. Plugs into the SOURCE_REGISTRY in utils/visionEngine.js as the
-- third source. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS vision_reference_images (
  image_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,          -- relative URL under /uploads/vision/
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  caption       TEXT,                   -- optional owner note ("finished 40x60 barn, 2025")
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vision_reference_images_brand
  ON vision_reference_images (brand_id, created_at DESC);
