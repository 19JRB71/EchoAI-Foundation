-- Scheduler run telemetry + cross-replica claims (Prompt 010).
--
-- Every scheduled (job_name, tick) gets exactly ONE canonical row here: the
-- INSERT itself is the atomic claim (unique on job_name + tick_key with
-- ON CONFLICT DO NOTHING), so when multiple replicas fire the same cron tick
-- only one wins and executes. The row is created with outcome 'running'
-- immediately after the claim, then finalized with the truthful outcome:
--   success — the job ran to completion,
--   skipped — the claim won but existing gating/business logic declined,
--   failed  — the job threw; the error is recorded here, never re-thrown.
CREATE TABLE IF NOT EXISTS job_runs (
  run_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name    TEXT NOT NULL,
  tick_key    TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  outcome     TEXT NOT NULL DEFAULT 'running'
              CHECK (outcome IN ('running', 'success', 'skipped', 'failed')),
  error       TEXT,
  duration_ms INTEGER,
  UNIQUE (job_name, tick_key)
);

-- Telemetry extracts read recent runs per job.
CREATE INDEX IF NOT EXISTS idx_job_runs_name_started
  ON job_runs (job_name, started_at DESC);
