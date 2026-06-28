-- ============================================================================
-- EchoAI - Migration: AI Content Calendar & Auto-Posting Scheduler
-- ----------------------------------------------------------------------------
-- Adds the content_calendars table (a brand's monthly, AI-planned posting plan)
-- and links generated posts back to their calendar via social_posts.calendar_id.
-- Calendar posts reuse the existing social_posts lifecycle + scheduler; the
-- scheduler only auto-publishes a calendar post when its calendar is 'active'.
--
-- Run with:  psql "$DATABASE_URL" -f models/028_content_calendar.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_calendar_status') THEN
        CREATE TYPE content_calendar_status AS ENUM ('draft', 'active', 'paused');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- content_calendars: a brand's AI-planned 30-day posting calendar
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_calendars (
    calendar_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    month             INTEGER NOT NULL,
    year              INTEGER NOT NULL,
    posting_frequency VARCHAR(32) NOT NULL,
    content_theme     TEXT,
    status            content_calendar_status NOT NULL DEFAULT 'draft',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_calendars_brand_id ON content_calendars (brand_id);
CREATE INDEX IF NOT EXISTS idx_content_calendars_status ON content_calendars (status);

-- ----------------------------------------------------------------------------
-- Link generated posts to their calendar. Deleting a calendar removes its posts.
-- ----------------------------------------------------------------------------
ALTER TABLE social_posts
    ADD COLUMN IF NOT EXISTS calendar_id UUID
        REFERENCES content_calendars (calendar_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_social_posts_calendar_id ON social_posts (calendar_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_content_calendars_updated_at ON content_calendars;
CREATE TRIGGER trg_content_calendars_updated_at BEFORE UPDATE ON content_calendars
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
