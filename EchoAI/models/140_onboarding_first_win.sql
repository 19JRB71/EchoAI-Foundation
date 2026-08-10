-- 140: Prompt 024 — honest onboarding first win (Stage-2 authorization, D-37).
--
-- EXACTLY the three authorized schema items (Section L):
--   1. armed_publish_authorizations  — artifact-bound consent records
--   2. onboarding_first_win_celebrations — provider-agnostic insert-once
--      celebration claims (proof_id UNIQUE)
--   3. social_posts 'prepared' status widening. social_posts.status is an
--      ENUM (social_post_status, migration 012), not a CHECK constraint, so
--      the additive widening authorized by Section A3/L is
--      ALTER TYPE ... ADD VALUE — the enum-typed equivalent of the CHECK
--      widening. Additive only; no existing value or row changes.
--
-- No other schema change. No existing table/column is modified.

-- (3) Additive status value. Safe inside the per-file migration transaction
-- on PostgreSQL 12+ because the new value is not used later in this file.
ALTER TYPE social_post_status ADD VALUE IF NOT EXISTS 'prepared';

-- (1) Armed publish authorizations: one row per act of owner consent, bound
-- to the exact prepared artifact via content_hash. Statuses (Section A4):
--   armed            — consent captured, waiting for a connection callback
--   claimed          — atomically claimed by the callback handoff transaction
--   consumed         — the canonical publish path completed with provider success
--   execution_failed — publish failed WITH definitive no-side-effect evidence
--   disarmed         — owner withdrew consent before any claim
--   invalidated      — consent no longer matches reality
--                      (invalidation_reason: content_changed / page_switched / expired)
-- claimed -> armed is ILLEGAL and enforced in the guarded update logic
-- (utils/onboardingFirstWin.js); retry after any terminal state is a NEW row.
-- Historical terminal rows are retained — never rewritten.
--
-- Deliberately NO FK to users/brands (audit-adjacent record must not block or
-- cascade with tenant deletion; same reasoning as agent_tasks, migration 131).
-- post_id IS an FK to social_posts per the Stage-2 authorization (A4).
CREATE TABLE IF NOT EXISTS armed_publish_authorizations (
  authorization_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  brand_id             UUID NOT NULL,
  post_id              UUID NOT NULL REFERENCES social_posts (post_id) ON DELETE CASCADE,
  content_hash         TEXT NOT NULL,
  destination_page_id  TEXT,
  destination_bound_at TIMESTAMPTZ,
  consent_copy_version TEXT NOT NULL,
  consent_captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  armed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status               TEXT NOT NULL CHECK (status IN (
    'armed', 'claimed', 'consumed', 'execution_failed', 'disarmed', 'invalidated'
  )),
  invalidation_reason  TEXT CHECK (invalidation_reason IN
    ('content_changed', 'page_switched', 'expired')),
  claimed_at           TIMESTAMPTZ,
  consumed_at          TIMESTAMPTZ,
  disarmed_at          TIMESTAMPTZ,
  execution_failed_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most ONE active (armed or claimed) authorization per prepared post
-- (Section A4). Terminal history rows never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_armed_publish_auth_active
  ON armed_publish_authorizations (post_id)
  WHERE status IN ('armed', 'claimed');

CREATE INDEX IF NOT EXISTS idx_armed_publish_auth_user
  ON armed_publish_authorizations (user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_armed_publish_auth_updated_at
  ON armed_publish_authorizations;
CREATE TRIGGER trg_armed_publish_auth_updated_at
  BEFORE UPDATE ON armed_publish_authorizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- (2) Provider-agnostic exactly-once celebration claims (Section D2).
-- proof_id UNIQUE NOT NULL is the whole mechanism: whichever authenticated
-- surface INSERTs first celebrates; every later claim hits the unique
-- conflict and renders the quiet "won" state. proof_id is a plain UUID
-- reference to external_proofs.proof_id — deliberately NO FK, because
-- external_proofs is append-only/immutable-trigger guarded (migration 130)
-- and an FK ON DELETE action could either block or silently erase
-- acceptance/audit history (Section D2 forbids such a cascade).
CREATE TABLE IF NOT EXISTS onboarding_first_win_celebrations (
  celebration_claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id             UUID NOT NULL UNIQUE,
  user_id              UUID NOT NULL,
  brand_id             UUID,
  provider             TEXT NOT NULL,
  claimed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_celebrations_user
  ON onboarding_first_win_celebrations (user_id, claimed_at DESC);
