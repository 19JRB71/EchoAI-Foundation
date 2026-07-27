-- 043_setup_agent_lifecycle.sql
-- Resumable-session lifecycle tracking for the AI Setup Agent.
--
-- Adds explicit lifecycle timestamps (started/paused/resumed; completed_at &
-- updated_at already exist) so a paused run can be reliably resumed, plus a
-- durable pointer to the brand-discovery session used by the first setup action
-- so a crash between brand creation and the completed-steps write can recover the
-- already-created brand instead of creating a duplicate. Idempotent.

ALTER TABLE setup_sessions
  ADD COLUMN IF NOT EXISTS started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS paused_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resumed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_session_id UUID;

-- Backfill started_at for any rows created before this column existed.
UPDATE setup_sessions SET started_at = created_at WHERE started_at IS NULL;
