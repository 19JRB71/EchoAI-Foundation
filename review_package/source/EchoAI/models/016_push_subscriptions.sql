-- ============================================================================
-- EchoAI - Migration: Web Push subscriptions (PWA hot-lead alerts)
-- ----------------------------------------------------------------------------
-- Adds the push_subscriptions table used by the PWA push system. Each row is a
-- single browser/device PushSubscription owned by a user. The endpoint is the
-- globally-unique address the push service exposes for that device, and `keys`
-- holds the p256dh/auth pair needed to encrypt the payload.
--
-- Run with:  psql "$DATABASE_URL" -f models/016_push_subscriptions.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    subscription_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    endpoint         TEXT NOT NULL UNIQUE,
    keys             JSONB NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON push_subscriptions (user_id);

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at BEFORE UPDATE ON push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
