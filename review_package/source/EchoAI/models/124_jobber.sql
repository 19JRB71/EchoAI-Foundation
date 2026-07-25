-- Jobber integration (field-service CRM).
--
-- One Jobber connection per user (mirrors google_integrations: user-scoped,
-- tokens AES-256-GCM encrypted at rest, status probed live by the checklist).
-- leads.jobber_client_id links a Zorecho lead to the Jobber client it was
-- imported from / exported to, and doubles as the idempotency key so a lead
-- is never pushed to Jobber twice.

CREATE TABLE IF NOT EXISTS jobber_integrations (
    jobber_integration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    jobber_account_name   VARCHAR(255),
    access_token_encrypted  TEXT,
    refresh_token_encrypted TEXT,
    token_expiry          TIMESTAMPTZ,
    connection_status     VARCHAR(20) NOT NULL DEFAULT 'connected',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_jobber_integrations_updated_at ON jobber_integrations;
CREATE TRIGGER trg_jobber_integrations_updated_at
    BEFORE UPDATE ON jobber_integrations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE leads ADD COLUMN IF NOT EXISTS jobber_client_id TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_jobber_client_id
    ON leads (jobber_client_id) WHERE jobber_client_id IS NOT NULL;
