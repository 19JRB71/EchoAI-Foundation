-- ============================================================================
-- Migration 058: Echo Multi-Business Chief of Staff (portfolio intelligence)
--
-- Two owner-scoped tables that power the unified portfolio view across ALL of an
-- owner's REAL businesses. The demo brand (brands.is_demo = true, migration 053)
-- is excluded at the data-gathering layer (utils/portfolio.js) — it must never
-- appear in any portfolio total, score, briefing, or intelligence report.
--
--  * portfolio_health_scores — one deterministic 1-10 health score per brand per
--    day (computed from real cross-channel activity, NOT AI, so the daily job can
--    never 502). `factors` stores the sub-scores; `drivers` is a plain-English
--    explanation of what moved the score vs the prior snapshot. The daily history
--    powers the 12-week trajectory chart.
--  * cross_business_intelligence — one weekly AI report per OWNER synthesizing
--    patterns ACROSS their businesses (shared audiences, cross-referral value,
--    resource/skill transfer, attention-vs-revenue allocation).
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_health_scores (
  score_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  score_date   DATE NOT NULL,
  health_score NUMERIC(3, 1) NOT NULL CHECK (health_score >= 1 AND health_score <= 10),
  status       TEXT NOT NULL DEFAULT 'yellow', -- green | yellow | red
  factors      JSONB NOT NULL DEFAULT '{}'::jsonb,
  drivers      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_health_brand_date
  ON portfolio_health_scores (brand_id, score_date DESC);

DROP TRIGGER IF EXISTS trg_portfolio_health_scores_updated_at ON portfolio_health_scores;
CREATE TRIGGER trg_portfolio_health_scores_updated_at
  BEFORE UPDATE ON portfolio_health_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS cross_business_intelligence (
  report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  week_date    DATE NOT NULL,
  report       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_analysis  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_date)
);

CREATE INDEX IF NOT EXISTS idx_cross_business_user_week
  ON cross_business_intelligence (user_id, week_date DESC);

DROP TRIGGER IF EXISTS trg_cross_business_intelligence_updated_at ON cross_business_intelligence;
CREATE TRIGGER trg_cross_business_intelligence_updated_at
  BEFORE UPDATE ON cross_business_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
