-- ============================================================================
-- 060_target_goals.sql — Target Goals & KPI Tracking (Prompt 67)
--
-- Adds a per-brand "brand type" classifier that decides which goal categories
-- are relevant, a table of measurable monthly goals, and a daily snapshot table
-- that gives each goal a trend line + projected end-of-month value + history.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================================

-- --- Brand type -------------------------------------------------------------
-- Classifies a brand so the UI/engine shows only the relevant goal categories
-- (standard | affiliate | ecommerce | service | restaurant). App code
-- (config/goals.js) is the source of truth for the allowed values + category
-- mapping; the column just persists the owner's selection.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS brand_type VARCHAR(20) NOT NULL DEFAULT 'standard';

-- --- Goals ------------------------------------------------------------------
-- One row per active target the owner set for a brand. `metric_key` maps to a
-- metric in config/goals.js (which carries the direction/unit/aggregation);
-- `target_value` is the monthly target; `category` denormalizes the metric's
-- category so filtering by department/section is a cheap column read.
CREATE TABLE IF NOT EXISTS brand_goals (
    goal_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    category      VARCHAR(32) NOT NULL,
    metric_key    VARCHAR(64) NOT NULL,
    label         VARCHAR(160),
    target_value  NUMERIC(14, 2) NOT NULL CHECK (target_value >= 0),
    period        VARCHAR(16) NOT NULL DEFAULT 'monthly',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_goals_brand
    ON brand_goals (brand_id, status);

-- At most one active goal per metric per brand (a brand can't have two active
-- "new_leads" targets). Archived goals don't participate in the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_goals_active_metric
    ON brand_goals (brand_id, metric_key)
    WHERE status = 'active';

-- --- Daily snapshots --------------------------------------------------------
-- The daily scheduler writes one row per active goal per day: the measured
-- current value, the target at that time, the computed % to goal, and the
-- projected end-of-month value. This powers the trend arrow (today vs. an
-- earlier snapshot), the sparkline history, and audit of past progress.
CREATE TABLE IF NOT EXISTS goal_snapshots (
    snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id         UUID NOT NULL REFERENCES brand_goals (goal_id) ON DELETE CASCADE,
    brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    snapshot_date   DATE NOT NULL,
    current_value   NUMERIC(14, 2) NOT NULL DEFAULT 0,
    target_value    NUMERIC(14, 2) NOT NULL DEFAULT 0,
    percent_to_goal NUMERIC(7, 2) NOT NULL DEFAULT 0,
    projected_eom   NUMERIC(14, 2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One snapshot per goal per day; the scheduler upserts on this so an overlapping
-- tick can't write two rows for the same day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_snapshots_goal_day
    ON goal_snapshots (goal_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_goal_snapshots_brand_day
    ON goal_snapshots (brand_id, snapshot_date);
