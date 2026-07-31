-- Prompt 006: external_proofs — the platform-wide external-evidence substrate.
--
-- Additive only. One table + an immutability guard:
--
-- external_proofs records ONE row per successfully-acknowledged provider
-- action (a Facebook publish, a Graph read-back, a Graph delete, an SMTP
-- send, ...). Rows are written ONLY from a real provider response, never
-- preemptively (owner term 4), and evidence jsonb stores the relevant
-- provider response VERBATIM WITH SECRETS REDACTED (owner term 10 — access
-- tokens, API keys, credentials are stripped by utils/externalProofs.js
-- before the row is written).
--
-- Designed for reuse by every later prompt (owner term 3):
--   * run_key groups all rows of one proof run; UNIQUE (run_key, provider,
--     action) is the idempotency key (owner term 12) — a retried runner can
--     never create duplicate proof rows.
--   * brand_id / user_id carry tenant scope (nullable: some future proofs
--     may be platform-level, e.g. a platform-cap change).
--   * environment records where the action really happened ('staging',
--     'production', 'development').
--   * verified_at is when the provider response was received; created_at is
--     the immutable row-creation time (owner term 13).
--
-- Immutability (owner term 13): a trigger rejects UPDATE and DELETE on
-- external_proofs — evidence is append-only. Corrections are new rows under
-- a new action/run_key, never edits. NOTE FOR ROLLBACK: dropping this table
-- destroys real external evidence; any rollback must warn the owner first.
--
-- No backfill: rows start from Prompt 006 onward (past proofs E-9..E-14 live
-- in the continuity docs by owner decision).

CREATE TABLE IF NOT EXISTS external_proofs (
  proof_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  action      TEXT NOT NULL,
  external_id TEXT,
  -- Tenant scope. Deliberately NOT foreign keys: evidence is immutable and
  -- must outlive the tenant (an FK ON DELETE action would try to mutate an
  -- append-only row and block account deletion).
  brand_id    UUID,
  user_id     UUID,
  environment TEXT NOT NULL,
  evidence    JSONB NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_proofs_run_action_unique UNIQUE (run_key, provider, action)
);

CREATE INDEX IF NOT EXISTS idx_external_proofs_run_key
  ON external_proofs (run_key);
CREATE INDEX IF NOT EXISTS idx_external_proofs_brand
  ON external_proofs (brand_id) WHERE brand_id IS NOT NULL;

-- Run binding for the Prompt 006 proof runner: the proof post is claimed by
-- its run key BEFORE it is ever published (unique partial index = atomic
-- claim), so a retried runner always finds the SAME social_posts row and can
-- never publish a second live post — even if the crash happened between the
-- publish and the proof-row write (owner term 12).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS proof_run_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_proof_run_key
  ON social_posts (proof_run_key) WHERE proof_run_key IS NOT NULL;

-- Append-only guard: proof rows can never be edited or deleted through SQL.
CREATE OR REPLACE FUNCTION external_proofs_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'external_proofs is append-only: % is not allowed (proof evidence is immutable)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_external_proofs_immutable ON external_proofs;
CREATE TRIGGER trg_external_proofs_immutable
  BEFORE UPDATE OR DELETE ON external_proofs
  FOR EACH ROW EXECUTE FUNCTION external_proofs_immutable();
