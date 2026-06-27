-- ============================================================================
-- EchoAI - Migration: AI-generated marketing images
-- ----------------------------------------------------------------------------
-- Adds the image_status enum and the images table used by the AI Image
-- Generation system (Image Studio). Each row is a brand-scoped, saved image
-- with the DALL-E prompt that produced it, its serving URL, and the platform it
-- was created for.
--
-- Run with:  psql "$DATABASE_URL" -f models/015_images.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_status') THEN
        CREATE TYPE image_status AS ENUM ('saved', 'used');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS images (
    image_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    purpose      VARCHAR(64) NOT NULL,
    prompt_used  TEXT NOT NULL,
    image_url    TEXT NOT NULL,
    platform     VARCHAR(64),
    status       image_status NOT NULL DEFAULT 'saved',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_images_brand_id ON images (brand_id);
CREATE INDEX IF NOT EXISTS idx_images_purpose ON images (purpose);
CREATE INDEX IF NOT EXISTS idx_images_status ON images (status);

DROP TRIGGER IF EXISTS trg_images_updated_at ON images;
CREATE TRIGGER trg_images_updated_at BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
