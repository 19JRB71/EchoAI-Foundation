-- 110_hybrid_creative_engine.sql
--
-- Hybrid Creative Engine: Forge picks a creative mode PER ITEM instead of
-- assuming every post is pure AI. Modes:
--   'asset'    — the owner's real photo, enhanced only (lighting/color/quality)
--   'assisted' — the owner's real photo + permitted AI edits (sky, season, ...)
--   'ai'       — an original AI concept that never pretends to depict a
--                specific real project/product
--
-- The owner controls behavior via two settings on autopilot_settings:
--   content_preference  — only_my_media | prefer_my_media | balanced_auto |
--                         mostly_ai | ai_only
--   editing_permissions — JSONB map of edit-type booleans (utils/creativeModes.js
--                         is the source of truth for the keys)
--
-- Source photos come from the Vision reference library (vision_reference_images)
-- — the owner's deliberately uploaded real photos. Idempotent.

ALTER TABLE autopilot_settings
  ADD COLUMN IF NOT EXISTS content_preference TEXT NOT NULL DEFAULT 'balanced_auto',
  ADD COLUMN IF NOT EXISTS editing_permissions JSONB;

ALTER TABLE autopilot_batch_items
  ADD COLUMN IF NOT EXISTS creative_mode TEXT,
  ADD COLUMN IF NOT EXISTS source_image_id UUID
    REFERENCES vision_reference_images (image_id) ON DELETE SET NULL;
