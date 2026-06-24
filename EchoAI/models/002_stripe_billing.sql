-- ============================================================================
-- EchoAI - Migration: Stripe billing columns
-- ----------------------------------------------------------------------------
-- Adds the identifiers needed to link local records to Stripe objects so that
-- webhooks and cancellations can be correlated back to a user/subscription.
--
-- Run with:  psql "$DATABASE_URL" -f models/002_stripe_billing.sql
-- ============================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE;

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions (stripe_subscription_id);

COMMIT;
