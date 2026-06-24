-- ============================================================================
-- EchoAI - Migration: Facebook Ad Campaign columns
-- ----------------------------------------------------------------------------
-- Adds the columns needed to link local records to Facebook objects and to
-- track campaign status for the Ad Campaign Agent.
--
-- Run with:  psql "$DATABASE_URL" -f models/003_facebook_campaign.sql
-- ============================================================================

BEGIN;

-- Stores the connected Facebook ad account id (e.g. act_123456789).
ALTER TABLE api_integrations
    ADD COLUMN IF NOT EXISTS account_ref VARCHAR(255);

-- Link local campaigns to their Facebook campaign + ad set, and track status.
ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS facebook_campaign_id VARCHAR(255);

ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS facebook_adset_id VARCHAR(255);

ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_facebook_campaign_id ON campaigns (facebook_campaign_id);

COMMIT;
