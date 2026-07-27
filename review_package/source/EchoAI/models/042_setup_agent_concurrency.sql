-- 042_setup_agent_concurrency.sql
-- Concurrency guard for the AI Setup Agent action runner.
--
-- The /execute endpoint runs one setup action per call and is invoked repeatedly
-- by the client. Add a compare-and-swap "executing" flag so two overlapping calls
-- can never run the same pending step twice (which could duplicate side effects
-- like a saved ad creative or email sequence). Idempotent: safe to re-run.

ALTER TABLE setup_sessions
  ADD COLUMN IF NOT EXISTS executing    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS executing_at TIMESTAMPTZ;
