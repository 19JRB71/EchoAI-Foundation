-- Migration 004: Brand Discovery sessions
-- Persists the state of the three-part brand discovery conversation between
-- exchanges so the agent can resume a session and synthesize the final profile.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS brand_discovery_sessions (
    session_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    brand_id       UUID REFERENCES brands (brand_id) ON DELETE CASCADE,
    status         VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | completed
    messages       JSONB NOT NULL DEFAULT '[]'::jsonb,
    draft_profile  JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_discovery_user_id ON brand_discovery_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_brand_discovery_brand_id ON brand_discovery_sessions (brand_id);

DROP TRIGGER IF EXISTS trg_brand_discovery_updated_at ON brand_discovery_sessions;
CREATE TRIGGER trg_brand_discovery_updated_at BEFORE UPDATE ON brand_discovery_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
