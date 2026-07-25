-- ============================================================================
-- EchoAI - Migration: AI Email Marketing Campaigns
-- ----------------------------------------------------------------------------
-- Adds the email_campaign_status enum and the email_campaigns and email_sends
-- tables used by the AI Email Marketing Campaign Agent. A campaign stores a
-- generated multi-email sequence (JSON) and tracks how far it has been sent;
-- email_sends records every individual send so open/click/unsubscribe rates can
-- be computed per campaign. Brand-scoped, consistent with the other content
-- subsystems.
--
-- Run with:  psql "$DATABASE_URL" -f models/014_email_campaigns.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_campaign_status') THEN
        CREATE TYPE email_campaign_status AS ENUM ('draft', 'active', 'completed');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- email_campaigns: a saved, AI-generated email sequence for a brand
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_campaigns (
    campaign_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    campaign_name  VARCHAR(255) NOT NULL,
    goal           TEXT NOT NULL,
    email_sequence JSONB NOT NULL,
    status         email_campaign_status NOT NULL DEFAULT 'draft',
    -- How many emails in the sequence have been sent (also the index of the next
    -- email to send). Drives the "next scheduled email" + progress indicator.
    current_step   INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_brand_id ON email_campaigns (brand_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns (status);

-- ----------------------------------------------------------------------------
-- email_sends: one row per individual email sent to a lead
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_sends (
    send_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id    UUID NOT NULL REFERENCES email_campaigns (campaign_id) ON DELETE CASCADE,
    lead_id        UUID REFERENCES leads (lead_id) ON DELETE SET NULL,
    email_address  VARCHAR(255) NOT NULL,
    subject        TEXT NOT NULL,
    sequence_step  INTEGER NOT NULL DEFAULT 0,
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at      TIMESTAMPTZ,
    clicked_at     TIMESTAMPTZ,
    unsubscribed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_sends_campaign_id ON email_sends (campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_lead_id ON email_sends (lead_id);

-- Idempotency backstop: a given recipient can only be recorded once per email
-- step of a campaign, so retries / concurrent sends cannot create duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_sends_campaign_addr_step
    ON email_sends (campaign_id, email_address, sequence_step);

-- ----------------------------------------------------------------------------
-- updated_at trigger (email_campaigns only; email_sends rows are append-mostly)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated_at BEFORE UPDATE ON email_campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
