-- Prompt 020 — external_actions: the attempt ledger for every external
-- side-effect executed through utils/executeExternal.js (D-30 §2 boundary:
--   external_actions  = attempt ledger (this table)
--   agent_task_events = lifecycle (migration 131)
--   external_proofs   = provider evidence (migration 130)
-- No duplication — rows here REFERENCE task_id / proof_id, never copy them).
--
-- Idempotency is guaranteed at the DATABASE level, not in code: the partial
-- unique index below allows at most ONE row per idempotency_key that is
-- in_progress or succeeded. A second fire of the same key hits 23505 and the
-- helper returns the prior action without any provider call. Failed rows do
-- NOT block — a classified-transient failure may be retried by the owning
-- feature as a new attempt row (attempt = prior + 1), exactly mirroring the
-- publish path's proven policy.
--
-- No FKs by design (mirrors agent_tasks / external_proofs): the ledger must
-- survive feature-row deletion — it is the record that something happened.

CREATE TABLE IF NOT EXISTS external_actions (
  action_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  attempt         INT  NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  provider        TEXT NOT NULL,
  action          TEXT NOT NULL,
  task_id         UUID,
  proof_id        UUID,
  brand_id        UUID,
  user_id         UUID,
  status          TEXT NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  -- On failure: 'transient' (feature may retry) or 'terminal'
  -- (MANUAL_REVIEW / owner attention); 'interrupted' when a reconciliation
  -- sweep closed a row stranded by a crash (bookkeeping only — the provider
  -- call may or may not have happened; it is NEVER re-executed from here).
  classification  TEXT CHECK (classification IN ('transient', 'terminal', 'interrupted')),
  error           TEXT,
  external_ref    TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Dedup hits observed against this row (metrics only, never authoritative).
  dedup_count     INT NOT NULL DEFAULT 0,
  -- One owner alert per underlying failure: set by an atomic CAS
  -- (WHERE alerted_at IS NULL); losers never alert again.
  alerted_at      TIMESTAMPTZ,
  reconciled_at   TIMESTAMPTZ,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every attempt is its own row; (key, attempt) is the attempt identity.
CREATE UNIQUE INDEX IF NOT EXISTS external_actions_key_attempt
  ON external_actions (idempotency_key, attempt);

-- THE dedup guarantee: at most one live-or-successful execution per key.
CREATE UNIQUE INDEX IF NOT EXISTS external_actions_active_key
  ON external_actions (idempotency_key)
  WHERE status IN ('in_progress', 'succeeded');

CREATE INDEX IF NOT EXISTS external_actions_task
  ON external_actions (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_actions_status_started
  ON external_actions (status, started_at);
