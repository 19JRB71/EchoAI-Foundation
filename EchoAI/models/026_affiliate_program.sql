-- ============================================================================
-- Migration 026: Affiliate program
--
-- Adds:
--   - affiliates: one row per user enrolled in the affiliate program (anyone
--     can join). user_id is UNIQUE so each account is an affiliate at most once.
--     referral_code is UNIQUE — it's the public code shared in referral links.
--     total_earned / total_paid are running lifetime rollups; paypal_email is
--     where approved commissions are sent. status gates whether new signups are
--     attributed (suspended affiliates earn nothing on new referrals).
--   - referrals: one row per referred user (referred_user_id is UNIQUE so a
--     user is attributed to exactly one affiliate, set at signup). A row is
--     created at signup with commission_amount 0 / status 'pending' (a tracked
--     signup). On the referred user's FIRST successful payment the commission is
--     filled in (20% of that first month). Lifecycle: pending -> approved ->
--     paid, advanced by the platform owner.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded). set_updated_at() is
-- defined in schema.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS affiliates (
    affiliate_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
    referral_code  VARCHAR(32) NOT NULL UNIQUE,
    paypal_email   VARCHAR(255),
    total_earned   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    total_paid     NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
    status         VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Attribution lookup path: resolve a shared referral code to its affiliate.
CREATE INDEX IF NOT EXISTS idx_affiliates_referral_code
    ON affiliates (referral_code);

DROP TRIGGER IF EXISTS trg_affiliates_updated_at ON affiliates;
CREATE TRIGGER trg_affiliates_updated_at BEFORE UPDATE ON affiliates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS referrals (
    referral_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id       UUID NOT NULL REFERENCES affiliates (affiliate_id) ON DELETE CASCADE,
    referred_user_id   UUID NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
    referral_code_used VARCHAR(32) NOT NULL,
    commission_amount  NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
    status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'paid')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rollups (counts, commission sums) are grouped by affiliate.
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate
    ON referrals (affiliate_id);

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON referrals;
CREATE TRIGGER trg_referrals_updated_at BEFORE UPDATE ON referrals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
