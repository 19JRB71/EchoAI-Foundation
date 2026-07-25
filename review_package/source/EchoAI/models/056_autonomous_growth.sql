-- 056_autonomous_growth.sql
-- Part 3: Stronger Autonomous Growth Mode.
--
-- Adds the persistence the daily autonomous engine needs on top of the existing
-- growth_settings (guardrails) + growth_actions (audit log) tables from
-- migration 049:
--   * growth_actions gains a structured category + payload so a proposed action
--     can be executed later on approval, and executed_at to record when an
--     auto/approved action actually ran.
--   * growth_brand_state stores per-brand learned state (the follow-up timing
--     factor derived from response rate, and the latest audience insight note)
--     plus a per-brand run timestamp used for cooldowns.
--   * growth_daily_summaries dedups the once-per-day owner summary so overlapping
--     scheduler ticks can't send it twice.
-- All idempotent (IF NOT EXISTS / guarded ALTERs).

-- --- growth_actions: structured category + executable payload -----------------
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;

-- Drives the "pending proposals for this owner" lookup the companion UI uses.
CREATE INDEX IF NOT EXISTS idx_growth_actions_pending
  ON growth_actions (user_id, created_at DESC)
  WHERE status = 'proposed';

-- --- per-brand learned autonomous state --------------------------------------
CREATE TABLE IF NOT EXISTS growth_brand_state (
  brand_id              UUID PRIMARY KEY REFERENCES brands(brand_id) ON DELETE CASCADE,
  followup_timing_factor NUMERIC(5,2) NOT NULL DEFAULT 1.0, -- <1 tightens, >1 spaces out
  audience_notes        TEXT,
  last_run_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --- once-per-day owner summary dedup ----------------------------------------
CREATE TABLE IF NOT EXISTS growth_daily_summaries (
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  action_count INTEGER NOT NULL DEFAULT 0,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, summary_date)
);
