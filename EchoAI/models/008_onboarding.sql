-- ============================================================================
-- EchoAI - Migration 008: Customer onboarding
-- ----------------------------------------------------------------------------
-- Adds onboarding progress tracking so the setup wizard can resume where a
-- customer left off, plus the account-setup fields captured in step one of the
-- wizard (business name and industry/niche). team_size already exists on users.
--
-- Run with:  psql "$DATABASE_URL" -f models/008_onboarding.sql
-- ============================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 1 CHECK (onboarding_step >= 1);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS business_name VARCHAR(255);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS industry VARCHAR(255);

COMMIT;
