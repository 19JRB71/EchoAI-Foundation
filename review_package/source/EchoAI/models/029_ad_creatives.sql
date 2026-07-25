-- Migration 029: AI Ad Creative Studio
--
-- Stores AI-generated ad creative packages (5 per generation) for a brand, the
-- single package launched into Facebook (if any), and the real performance
-- metrics pulled back from Facebook for launched creatives.

CREATE TABLE IF NOT EXISTS ad_creatives (
    creative_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id             UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    campaign_goal        TEXT NOT NULL,
    -- { packages: [...5], budgetRange, productFocus } produced by the AI agent.
    creative_concept     JSONB NOT NULL,
    status               TEXT NOT NULL DEFAULT 'draft',  -- draft | launched | archived
    -- The single creative package that was launched (concept/angle/headline/cta).
    launched_package     JSONB,
    facebook_campaign_id TEXT,
    facebook_adset_id    TEXT,
    campaign_id          UUID REFERENCES campaigns (campaign_id) ON DELETE SET NULL,
    -- Real Facebook insights for the launched creative, refreshed weekly.
    performance_data     JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_brand_id ON ad_creatives (brand_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_status ON ad_creatives (status);

DROP TRIGGER IF EXISTS trg_ad_creatives_updated_at ON ad_creatives;
CREATE TRIGGER trg_ad_creatives_updated_at BEFORE UPDATE ON ad_creatives
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
