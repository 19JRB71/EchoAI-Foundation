-- ============================================================================
-- 037_email_marketing.sql — AI Email Marketing Campaigns (Professional tier)
--
-- One-time email blasts and multi-email drip sequences, sent to brand leads via
-- nodemailer with open/click tracking, public unsubscribe, and brand-scoped
-- opt-out enforcement. Tables are namespaced `email_marketing_*` to avoid any
-- collision with the legacy `/api/email-campaigns` tables (014). All idempotent
-- (IF NOT EXISTS + guarded enum creation).
-- ============================================================================

BEGIN;

-- Campaign type: a single blast vs an automated drip sequence.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_marketing_campaign_type') THEN
        CREATE TYPE email_marketing_campaign_type AS ENUM ('one-time', 'drip');
    END IF;
END$$;

-- Campaign lifecycle. one-time: draft -> sending -> sent. drip: sending (active)
-- <-> paused (scheduler skips it). 'scheduled' reserved for future timed sends.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_marketing_status') THEN
        CREATE TYPE email_marketing_status AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'paused');
    END IF;
END$$;

-- Per-recipient delivery state. For drips a recipient stays 'pending' while it
-- still has steps to send, then becomes 'sent' once the sequence completes.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_marketing_delivery_status') THEN
        CREATE TYPE email_marketing_delivery_status AS ENUM ('pending', 'sent', 'failed', 'unsubscribed');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- email_marketing_campaigns — one campaign (blast or drip) per row.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_marketing_campaigns (
    campaign_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    campaign_name    VARCHAR(255) NOT NULL,
    campaign_type    email_marketing_campaign_type NOT NULL DEFAULT 'one-time',
    goal             TEXT NOT NULL DEFAULT '',
    segment_filter   VARCHAR(50) NOT NULL DEFAULT 'all',
    status           email_marketing_status NOT NULL DEFAULT 'draft',
    recipient_count  INTEGER NOT NULL DEFAULT 0,
    sent_count       INTEGER NOT NULL DEFAULT 0,
    open_count       INTEGER NOT NULL DEFAULT 0,
    click_count      INTEGER NOT NULL DEFAULT 0,
    scheduled_at     TIMESTAMPTZ,
    sent_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_em_campaigns_brand_id ON email_marketing_campaigns (brand_id);
CREATE INDEX IF NOT EXISTS idx_em_campaigns_status ON email_marketing_campaigns (status);

-- ----------------------------------------------------------------------------
-- email_marketing_emails — the email(s) belonging to a campaign. A one-time
-- campaign has exactly one (sequence_position 0); a drip has one per step.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_marketing_emails (
    email_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id       UUID NOT NULL REFERENCES email_marketing_campaigns (campaign_id) ON DELETE CASCADE,
    sequence_position INTEGER NOT NULL DEFAULT 0,
    subject_line      TEXT NOT NULL,
    preview_text      TEXT NOT NULL DEFAULT '',
    body_html         TEXT NOT NULL,
    body_plain_text   TEXT NOT NULL DEFAULT '',
    send_delay_days   INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_em_emails_campaign_id ON email_marketing_emails (campaign_id);
-- One email per (campaign, position) — idempotency backstop for saves/retries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_em_emails_campaign_position
    ON email_marketing_emails (campaign_id, sequence_position);

-- ----------------------------------------------------------------------------
-- email_marketing_recipients — one row per (campaign, recipient). For drips,
-- current_step tracks the next sequence_position to send and next_send_at gates
-- the hourly scheduler.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_marketing_recipients (
    recipient_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id      UUID NOT NULL REFERENCES email_marketing_campaigns (campaign_id) ON DELETE CASCADE,
    lead_id          UUID REFERENCES leads (lead_id) ON DELETE SET NULL,
    email_address    VARCHAR(255) NOT NULL,
    delivery_status  email_marketing_delivery_status NOT NULL DEFAULT 'pending',
    current_step     INTEGER NOT NULL DEFAULT 0,
    next_send_at     TIMESTAMPTZ,
    opened_at        TIMESTAMPTZ,
    clicked_at       TIMESTAMPTZ,
    unsubscribed_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_em_recipients_campaign_id ON email_marketing_recipients (campaign_id);
CREATE INDEX IF NOT EXISTS idx_em_recipients_lead_id ON email_marketing_recipients (lead_id);
-- Drip scheduler hot path: pending rows whose next send is due.
CREATE INDEX IF NOT EXISTS idx_em_recipients_due
    ON email_marketing_recipients (next_send_at)
    WHERE delivery_status = 'pending';
-- One recipient row per (campaign, address) — dedup + ON CONFLICT backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_em_recipients_campaign_addr
    ON email_marketing_recipients (campaign_id, email_address);

-- ----------------------------------------------------------------------------
-- email_opt_outs — addresses that unsubscribed, scoped per brand. Checked
-- before EVERY outbound email across the email-marketing subsystem.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_opt_outs (
    opt_out_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    email_address VARCHAR(255) NOT NULL,
    opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One opt-out row per (brand, address); the app upserts with ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_opt_outs_brand_addr
    ON email_opt_outs (brand_id, email_address);

COMMIT;
