-- ============================================================================
-- EchoAI - Migration: AI Video Script & Content Creation
-- ----------------------------------------------------------------------------
-- Adds the video_script_status enum and the video_scripts table used by the
-- AI Video Content Agent. Each row stores a complete generated video package
-- (hook, scenes, on-screen text, CTA, music style, thumbnail concept) as JSON
-- so users can revisit saved scripts later. Brand-scoped, mirroring the rest
-- of the content subsystems.
--
-- Run with:  psql "$DATABASE_URL" -f models/013_video_scripts.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'video_script_status') THEN
        CREATE TYPE video_script_status AS ENUM ('draft', 'published');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- video_scripts: generated and saved AI video content packages
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS video_scripts (
    script_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    platform       social_platform NOT NULL,
    topic          TEXT NOT NULL,
    video_length   VARCHAR(16) NOT NULL,
    script_content JSONB NOT NULL,
    status         video_script_status NOT NULL DEFAULT 'draft',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_scripts_brand_id ON video_scripts (brand_id);
CREATE INDEX IF NOT EXISTS idx_video_scripts_platform ON video_scripts (platform);
CREATE INDEX IF NOT EXISTS idx_video_scripts_created_at ON video_scripts (created_at);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_video_scripts_updated_at ON video_scripts;
CREATE TRIGGER trg_video_scripts_updated_at BEFORE UPDATE ON video_scripts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
