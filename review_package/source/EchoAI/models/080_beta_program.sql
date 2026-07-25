-- ============================================================================
-- Migration 080: Beta Program Management
-- ============================================================================
-- Admin-controlled beta program: a capped number of free beta accounts, a
-- waitlist for when the cap is reached, activity tracking (login counts +
-- feature usage), automatic inactive warnings, and one-click convert-to-paid.
--
-- Run with:  psql "$DATABASE_URL" -f models/080_beta_program.sql
-- ============================================================================

-- Beta flags on users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_beta BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;
-- When the last "you've been inactive" warning email was sent. Cleared on
-- every login so a returning user can be warned again after a NEW idle spell.
ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_warning_sent_at TIMESTAMPTZ;

-- Backfill: accounts created under free test mode are the existing beta
-- testers — role 'user', enterprise tier, and no Stripe customer (they never
-- paid). Idempotent: re-running only re-flags the same accounts.
UPDATE users
   SET is_beta = TRUE
 WHERE role = 'user'
   AND subscription_tier = 'enterprise'
   AND stripe_customer_id IS NULL
   AND is_beta = FALSE;

-- Singleton settings row for the beta program.
CREATE TABLE IF NOT EXISTS beta_settings (
    id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_slots              INTEGER NOT NULL DEFAULT 10 CHECK (max_slots >= 0),
    -- "Active" = logged in within this many days.
    active_threshold_days  INTEGER NOT NULL DEFAULT 7 CHECK (active_threshold_days >= 1),
    -- Send the friendly warning email after this many days of no activity.
    warning_after_days     INTEGER NOT NULL DEFAULT 5 CHECK (warning_after_days >= 1),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO beta_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Waitlist for when the beta is at capacity.
CREATE TABLE IF NOT EXISTS beta_waitlist (
    waitlist_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        VARCHAR(255) NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set when the "a spot opened up" email goes out.
    notified_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_beta_waitlist_pending
    ON beta_waitlist (created_at)
    WHERE notified_at IS NULL;

-- Per-user feature usage, upserted by the auth middleware (throttled).
CREATE TABLE IF NOT EXISTS beta_feature_usage (
    user_id       UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    feature       VARCHAR(80) NOT NULL,
    uses          INTEGER NOT NULL DEFAULT 1,
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, feature)
);
