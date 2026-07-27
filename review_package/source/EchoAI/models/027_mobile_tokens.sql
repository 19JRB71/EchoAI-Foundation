-- Migration 027: Mobile token tables
--
-- Supports the native iOS/Android mobile API (/api/v2):
--   * refresh_tokens  — long-lived refresh tokens for seamless mobile re-auth.
--     Only the SHA-256 hash of the token is stored (never the raw token).
--   * device_tokens   — Firebase Cloud Messaging (FCM) push tokens, one row per
--     device, so the backend can push hot-lead / weekly-report / payment-failed
--     alerts to a user's phones.
--
-- Idempotent (IF NOT EXISTS + guarded triggers) so the runner can re-apply.

CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    device_id   TEXT,
    device_name TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS device_tokens (
    device_token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    push_token      TEXT NOT NULL UNIQUE,
    platform        TEXT NOT NULL DEFAULT 'android'
                    CHECK (platform IN ('ios', 'android', 'web')),
    device_id       TEXT,
    device_name     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id);

-- Keep updated_at fresh on re-registration (set_updated_at defined in schema.sql).
DROP TRIGGER IF EXISTS trg_device_tokens_updated_at ON device_tokens;
CREATE TRIGGER trg_device_tokens_updated_at BEFORE UPDATE ON device_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
