-- AI cost controls: admin-tunable settings, the central usage ledger, and
-- budget-alert dedup. Part of the launch-sprint cost work (Phases 1-3).

-- Key/value overrides for AI switches and budgets. Resolution order everywhere:
-- ai_settings row > environment variable > built-in default. Admin toggles land
-- here so no redeploy is needed to flip a switch.
CREATE TABLE IF NOT EXISTS ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER
);

-- One row per paid (or blocked) AI request, written by the provider wrappers.
-- This is the single source of truth for spend; budgets sum estimated_cost_usd.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  usage_id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  environment TEXT NOT NULL,
  deploy_version TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  brand_id INTEGER,
  user_id INTEGER,
  agent TEXT,
  feature TEXT NOT NULL,
  task_type TEXT,
  job_name TEXT,
  request_id TEXT,
  conversation_id TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'user',
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  web_searches INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  success BOOLEAN NOT NULL,
  error_category TEXT,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cache_checked BOOLEAN NOT NULL DEFAULT FALSE,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  cache_miss_reason TEXT,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage_log (at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_brand_at ON ai_usage_log (brand_id, at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_at ON ai_usage_log (provider, at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_at ON ai_usage_log (feature, at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_triggered_at ON ai_usage_log (triggered_by, at);

-- Budget threshold alerts, deduped: one row per scope + period + level so the
-- 75% warning for a given day fires exactly once no matter how many calls land.
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  alert_id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  period_key TEXT NOT NULL,
  level INTEGER NOT NULL,
  spent_usd NUMERIC(12, 6) NOT NULL,
  limit_usd NUMERIC(12, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, period_key, level)
);
