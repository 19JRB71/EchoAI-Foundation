-- API credit & quota monitoring (Sentinel).
--
-- Sentinel checks the platform's third-party API credit/quota levels every hour
-- and alerts the platform owner (admin) when a service drops below a warning
-- (20% remaining) or critical threshold, so no service ever runs out silently.
--
-- `api_quota_snapshots` holds exactly ONE latest row per provider (upserted each
-- sweep) so the Sentinel health monitor can show every level at a glance.
--
-- `api_quota_alert_log` is a per-day claim log: one (provider, severity, date)
-- row can be claimed once, so overlapping/repeated hourly sweeps can't spam the
-- owner. A warning that later escalates to critical still alerts because it is a
-- different severity row.

CREATE TABLE IF NOT EXISTS api_quota_snapshots (
  provider       TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  status         TEXT NOT NULL,       -- ok | low | critical | not_configured | unavailable | error
  used           NUMERIC,
  limit_total    NUMERIC,
  remaining      NUMERIC,
  pct_remaining  NUMERIC,
  unit           TEXT,                -- characters | usd | ... (null when not applicable)
  detail         TEXT,                -- plain-English note / reason
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_quota_alert_log (
  id          BIGSERIAL PRIMARY KEY,
  provider    TEXT NOT NULL,
  severity    TEXT NOT NULL,          -- low | critical
  alert_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, severity, alert_date)
);
