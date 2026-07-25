-- ============================================================================
-- 076_political_campaign.sql — Political Campaign brand type + Voter CRM
--
-- Adds:
--  - brands.campaign_profile: JSONB profile for political-campaign brands
--    (candidate name, office sought, district, key issues, voter demographics,
--    opponent, website/socials, "Paid for by" committee name). App code
--    (config/goals.js) owns the allowed brand_type values; 'political' is new.
--  - supporters: the Voter CRM — every voter, donor, and volunteer contact for
--    a campaign brand, with follow-up status and optional donation amount.
--  - campaign_events: campaign events with attendance, powering the
--    event-attendance goal metric.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================================

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS campaign_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- --- Voter CRM: supporters ---------------------------------------------------
CREATE TABLE IF NOT EXISTS supporters (
    supporter_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    email           VARCHAR(255),
    phone           VARCHAR(40),
    -- voter | donor | volunteer (app code validates; a contact can be upgraded)
    supporter_type  VARCHAR(20) NOT NULL DEFAULT 'voter',
    -- total donated to date (only meaningful for donors); NULL = none recorded
    donation_amount NUMERIC(12, 2) CHECK (donation_amount IS NULL OR donation_amount >= 0),
    notes           TEXT,
    -- new | contacted | engaged | committed (app code validates)
    status          VARCHAR(20) NOT NULL DEFAULT 'new',
    source          VARCHAR(60),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supporters_brand
    ON supporters (brand_id, supporter_type, created_at DESC);

-- --- Campaign events ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    event_name      VARCHAR(200) NOT NULL,
    event_date      DATE NOT NULL,
    location        VARCHAR(200),
    -- actual headcount once the event happened; NULL until recorded
    attendance      INTEGER CHECK (attendance IS NULL OR attendance >= 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_brand
    ON campaign_events (brand_id, event_date DESC);
