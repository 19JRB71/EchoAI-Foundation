-- ============================================================================
-- EchoAI - Migration: Multi-platform Social Media content + scheduling
-- ----------------------------------------------------------------------------
-- Adds the social platform + post status enums and the social_accounts and
-- social_posts tables used by the Social Media Content Generation and Posting
-- system. Credentials for each connected platform are stored encrypted in
-- social_accounts (brand-scoped), mirroring how api_integrations stores the
-- encrypted Facebook ad token.
--
-- Run with:  psql "$DATABASE_URL" -f models/012_social_media.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'social_platform') THEN
        CREATE TYPE social_platform AS ENUM
            ('facebook', 'instagram', 'tiktok', 'linkedin', 'twitter', 'youtube');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'social_post_status') THEN
        CREATE TYPE social_post_status AS ENUM
            ('draft', 'scheduled', 'publishing', 'published', 'failed');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- social_accounts: a brand's connected social platform credentials
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_accounts (
    account_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id              UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    platform              social_platform NOT NULL,
    platform_username     VARCHAR(255),
    credentials_encrypted TEXT NOT NULL,
    connection_status     connection_status NOT NULL DEFAULT 'disconnected',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_brand_id ON social_accounts (brand_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts (platform);

-- ----------------------------------------------------------------------------
-- social_posts: generated, scheduled, and published posts across platforms
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_posts (
    post_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id           UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    platform           social_platform NOT NULL,
    post_content       TEXT NOT NULL,
    scheduled_time     TIMESTAMPTZ,
    published_time     TIMESTAMPTZ,
    status             social_post_status NOT NULL DEFAULT 'draft',
    engagement_metrics JSONB,
    external_post_id   VARCHAR(255),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_brand_id ON social_posts (brand_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts (platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts (status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled_time ON social_posts (scheduled_time);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_social_accounts_updated_at ON social_accounts;
CREATE TRIGGER trg_social_accounts_updated_at BEFORE UPDATE ON social_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_social_posts_updated_at ON social_posts;
CREATE TRIGGER trg_social_posts_updated_at BEFORE UPDATE ON social_posts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
