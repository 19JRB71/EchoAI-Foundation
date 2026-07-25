-- Migration 007: Competitor intelligence + optimization history
-- Adds storage for the AI Campaign Optimization engine:
--   * competitor_intelligence — structured competitor analysis reports per brand.
--   * optimization_history    — a log of every optimization applied to a campaign,
--                               including the changes made and before/after performance.

CREATE TABLE IF NOT EXISTS competitor_intelligence (
    intelligence_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    competitor_names    JSONB NOT NULL DEFAULT '[]'::jsonb,
    intelligence_report JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_intelligence_brand_id
    ON competitor_intelligence (brand_id);
CREATE INDEX IF NOT EXISTS idx_competitor_intelligence_created_at
    ON competitor_intelligence (created_at);

CREATE TABLE IF NOT EXISTS optimization_history (
    optimization_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    campaign_id         UUID REFERENCES campaigns (campaign_id) ON DELETE SET NULL,
    changes_made        JSONB,
    performance_before  JSONB,
    performance_after   JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_optimization_history_brand_id
    ON optimization_history (brand_id);
CREATE INDEX IF NOT EXISTS idx_optimization_history_campaign_id
    ON optimization_history (campaign_id);

DROP TRIGGER IF EXISTS trg_competitor_intelligence_updated_at ON competitor_intelligence;
CREATE TRIGGER trg_competitor_intelligence_updated_at BEFORE UPDATE ON competitor_intelligence
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_optimization_history_updated_at ON optimization_history;
CREATE TRIGGER trg_optimization_history_updated_at BEFORE UPDATE ON optimization_history
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
