-- 049_marketing_department.sql
-- "AI Marketing Department" transformation: Echo's persistent memory, the
-- Autonomous Growth Mode guardrail settings, and the log of growth actions Echo
-- proposes or auto-executes. All idempotent (IF NOT EXISTS).

-- Echo's long-term memory: a durable, append-only event log Echo can recall from
-- ("what happened with Bob?"). Complements live aggregation of existing tables;
-- stores notable events (approvals, launches, complaints, sales, etc.) explicitly.
CREATE TABLE IF NOT EXISTS echo_memory (
  memory_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  brand_id    UUID REFERENCES brands(brand_id) ON DELETE CASCADE,
  entity_type TEXT,              -- lead | customer | campaign | call | system ...
  entity_ref  TEXT,              -- a name / phone / email / id to recall by
  event_type  TEXT NOT NULL,     -- e.g. campaign_launched, lead_created, note
  title       TEXT NOT NULL,
  detail      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_echo_memory_user_time ON echo_memory (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_echo_memory_ref ON echo_memory (user_id, lower(entity_ref));

-- Autonomous Growth Mode guardrails (one row per account owner).
CREATE TABLE IF NOT EXISTS growth_settings (
  user_id            UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_budget_cap NUMERIC(12,2),          -- max total ad spend / month
  approval_threshold NUMERIC(12,2) DEFAULT 100,  -- spend changes above this need approval
  brand_voice_rules  TEXT,
  geo_targeting      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log of every autonomous/proposed action so Echo can explain what it did and why.
CREATE TABLE IF NOT EXISTS growth_actions (
  action_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  brand_id   UUID REFERENCES brands(brand_id) ON DELETE CASCADE,
  agent      TEXT,                          -- which team member acted (echo, atlas...)
  kind       TEXT NOT NULL,                 -- optimization | proposal | budget_change...
  risk       TEXT NOT NULL DEFAULT 'low',   -- low | high
  title      TEXT NOT NULL,
  detail     TEXT,                          -- Echo's explanation of the change + why
  status     TEXT NOT NULL DEFAULT 'proposed', -- proposed | auto_executed | approved | declined
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_growth_actions_user_time ON growth_actions (user_id, created_at DESC);
