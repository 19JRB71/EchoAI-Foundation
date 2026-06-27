-- ============================================================================
-- Migration 021: AI Phone Agent (Twilio)
--
-- Adds:
--   - call_direction enum (inbound | outbound)
--   - twilio_config: a brand's connected Twilio account + assigned phone number
--     (auth token stored AES-256-GCM encrypted, mirroring social_accounts)
--   - calls: one row per phone call (transcript, duration, outcome, and the
--     lead temperature scored after the call)
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded enum creation).
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_direction') THEN
        CREATE TYPE call_direction AS ENUM ('inbound', 'outbound');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- twilio_config: brand-scoped Twilio connection (one per brand)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS twilio_config (
    config_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    account_sid         VARCHAR(64) NOT NULL,
    auth_token_encrypted TEXT NOT NULL,
    phone_number        VARCHAR(32) NOT NULL,
    connection_status   VARCHAR(20) NOT NULL DEFAULT 'connected',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_id)
);

CREATE INDEX IF NOT EXISTS idx_twilio_config_brand_id ON twilio_config (brand_id);
-- Resolve inbound calls (Twilio gives us the dialed number) back to exactly ONE
-- brand. A global UNIQUE on the (E.164-normalized) number guarantees inbound
-- tenant resolution is deterministic and not order-dependent.
--
-- NOTE: an earlier revision of this migration created a NON-unique index of the
-- same name. `CREATE UNIQUE INDEX IF NOT EXISTS` would no-op on those installs
-- and leave the ambiguous index in place, so we DROP it first to force the
-- upgrade. If duplicate numbers already exist this CREATE fails LOUDLY — that is
-- intentional: cross-tenant number collisions must be resolved by hand.
DROP INDEX IF EXISTS idx_twilio_config_phone;
CREATE UNIQUE INDEX idx_twilio_config_phone
    ON twilio_config (phone_number);

-- ----------------------------------------------------------------------------
-- calls: phone call records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
    call_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    lead_id             UUID REFERENCES leads (lead_id) ON DELETE SET NULL,
    twilio_call_sid     VARCHAR(64),
    direction           call_direction NOT NULL,
    caller_phone        VARCHAR(50),
    duration_seconds    INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    transcript          JSONB NOT NULL DEFAULT '[]'::jsonb,
    outcome             VARCHAR(40),
    lead_temperature    lead_temperature,
    status              VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_brand_id ON calls (brand_id);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls (lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_twilio_sid
    ON calls (twilio_call_sid) WHERE twilio_call_sid IS NOT NULL;

-- updated_at triggers (set_updated_at() defined in schema.sql)
DROP TRIGGER IF EXISTS trg_twilio_config_updated_at ON twilio_config;
CREATE TRIGGER trg_twilio_config_updated_at BEFORE UPDATE ON twilio_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_calls_updated_at ON calls;
CREATE TRIGGER trg_calls_updated_at BEFORE UPDATE ON calls
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
