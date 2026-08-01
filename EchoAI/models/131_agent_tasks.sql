-- Prompt 009: agent task spine — canonical task rows + append-only lifecycle
-- trail. Additive only; no existing table, column, or behavior is changed.
--
-- agent_tasks: ONE mutable canonical row per unit of agent work (Prompt 009
-- adopter: task_type 'social_publish', source_type 'social_post'). The
-- UNIQUE (task_type, source_type, source_id, attempt) key is the source
-- idempotency guarantee (Owner Addendum G): a given publish attempt can never
-- create duplicate canonical rows; retries of the SAME attempt reuse the row,
-- a genuinely new attempt (e.g. calendar re-activation after CANCELLED) gets
-- attempt+1 explicitly.
--
-- agent_task_events: append-only audit trail. Every state transition and its
-- event are written in ONE database transaction (Stage-2 authorization,
-- addition 1) by utils/taskSpine.js — no task advance without its event, no
-- event without its task state. A trigger (same pattern as external_proofs,
-- migration 130) rejects UPDATE and DELETE.
--
-- Deliberately NO foreign keys (same reasoning as external_proofs): the audit
-- trail must outlive the tenant; an FK ON DELETE action would either block
-- account deletion or cascade-destroy the trail (and a cascade DELETE on the
-- events table would violate its own immutability trigger). proof_id is a
-- plain UUID reference to external_proofs.proof_id. Orphan cleanup is
-- deferred to the Prompt-029 audited-deletion design (owner-accepted).

CREATE TABLE IF NOT EXISTS agent_tasks (
  task_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL,
  user_id      UUID NOT NULL,
  task_type    TEXT NOT NULL CHECK (task_type IN ('social_publish', 'reconciliation')),
  source_type  TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  attempt      INT  NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status       TEXT NOT NULL CHECK (status IN (
    'DRAFTED', 'REVIEWED', 'APPROVED', 'QUEUED', 'EXECUTING',
    'PROVIDER_ACCEPTED', 'EXTERNALLY_VERIFIED', 'REPORTED', 'COMPLETED',
    'RETRY_SCHEDULED', 'AUTH_REQUIRED', 'PERMISSION_DENIED', 'RATE_LIMITED',
    'VALIDATION_FAILED', 'EXTERNAL_FAILURE', 'MANUAL_REVIEW', 'CANCELLED'
  )),
  title        TEXT NOT NULL,
  external_ref TEXT,
  proof_id     UUID,
  last_error   TEXT,
  meta         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_tasks_source_attempt_unique
    UNIQUE (task_type, source_type, source_id, attempt)
);

-- Activity/inbox query shapes (owner-facing Approvals & Activity list).
CREATE INDEX IF NOT EXISTS idx_agent_tasks_brand_updated
  ON agent_tasks (brand_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_brand_status
  ON agent_tasks (brand_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_created
  ON agent_tasks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_task_events (
  event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL,
  actor       TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_task_events_task
  ON agent_task_events (task_id, created_at);

-- Append-only guard: trail events can never be edited or deleted through SQL.
CREATE OR REPLACE FUNCTION agent_task_events_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'agent_task_events is append-only: % is not allowed (the task trail is immutable)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_task_events_immutable ON agent_task_events;
CREATE TRIGGER trg_agent_task_events_immutable
  BEFORE UPDATE OR DELETE ON agent_task_events
  FOR EACH ROW EXECUTE FUNCTION agent_task_events_immutable();
