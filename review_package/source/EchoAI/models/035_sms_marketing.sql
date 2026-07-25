-- ============================================================================
-- 035_sms_marketing.sql — Two-Way SMS Marketing (Professional tier)
--
-- Bulk AI-written SMS campaigns to leads/customers, two-way inbound replies with
-- AI auto-reply, and platform-wide opt-out enforcement. All tables are brand
-- scoped and idempotent (IF NOT EXISTS + guarded enum creation).
-- ============================================================================

BEGIN;

-- Campaign lifecycle: draft (queued, not yet sent) -> sending -> sent / failed.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_campaign_status') THEN
        CREATE TYPE sms_campaign_status AS ENUM ('draft', 'sending', 'sent', 'failed');
    END IF;
END$$;

-- Message direction relative to the brand.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_direction') THEN
        CREATE TYPE sms_direction AS ENUM ('inbound', 'outbound');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- sms_campaigns — one bulk send to a recipient segment.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_campaigns (
    campaign_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    campaign_name    VARCHAR(255) NOT NULL,
    message_content  TEXT NOT NULL,
    segment_filter   VARCHAR(50) NOT NULL DEFAULT 'all',
    status           sms_campaign_status NOT NULL DEFAULT 'draft',
    recipient_count  INTEGER NOT NULL DEFAULT 0,
    delivered_count  INTEGER NOT NULL DEFAULT 0,
    reply_count      INTEGER NOT NULL DEFAULT 0,
    scheduled_at     TIMESTAMPTZ,
    sent_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_campaigns_brand_id ON sms_campaigns (brand_id);
CREATE INDEX IF NOT EXISTS idx_sms_campaigns_status ON sms_campaigns (status);

-- ----------------------------------------------------------------------------
-- sms_messages — every inbound + outbound SMS (campaign blasts, auto-replies,
-- manual replies). campaign_id is NULL for one-off / inbound messages.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_messages (
    message_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id        UUID REFERENCES sms_campaigns (campaign_id) ON DELETE SET NULL,
    brand_id           UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    lead_id            UUID REFERENCES leads (lead_id) ON DELETE SET NULL,
    direction          sms_direction NOT NULL,
    message_body       TEXT NOT NULL,
    twilio_message_sid VARCHAR(64),
    delivery_status    VARCHAR(32) NOT NULL DEFAULT 'queued',
    sent_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_brand_id ON sms_messages (brand_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_campaign_id ON sms_messages (campaign_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_lead_id ON sms_messages (lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_direction ON sms_messages (direction);

-- ----------------------------------------------------------------------------
-- sms_opt_outs — numbers that have opted out, scoped per brand. Checked before
-- EVERY outbound SMS across the entire platform.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_opt_outs (
    opt_out_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One opt-out row per (brand, number); the app upserts with ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_opt_outs_brand_phone
    ON sms_opt_outs (brand_id, phone_number);

COMMIT;
