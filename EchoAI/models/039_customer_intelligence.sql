-- Migration 039: Customer Intelligence Engine (Enterprise)
--
-- The intelligence engine continuously synthesizes EVERY channel's data for a
-- business into a growing weekly strategic profile. Each weekly run stores one
-- customer_intelligence row (raw synthesized profile + AI recommendations +
-- detected trends + a 1-10 trajectory score + the executive analysis). Owners
-- can mark recommendations as applied and log outcomes in applied_recommendations
-- so the engine — and the owner — can track what actually moved the needle.

CREATE TABLE IF NOT EXISTS customer_intelligence (
  intelligence_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  week_date          DATE NOT NULL,
  raw_profile_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  trends_identified  JSONB NOT NULL DEFAULT '[]'::jsonb,
  trajectory_score   INTEGER,
  ai_analysis        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, week_date),
  CONSTRAINT customer_intelligence_score_range
    CHECK (trajectory_score IS NULL OR (trajectory_score >= 1 AND trajectory_score <= 10))
);

CREATE INDEX IF NOT EXISTS idx_customer_intelligence_brand_id
  ON customer_intelligence (brand_id);
CREATE INDEX IF NOT EXISTS idx_customer_intelligence_week
  ON customer_intelligence (brand_id, week_date DESC);

DROP TRIGGER IF EXISTS trg_customer_intelligence_updated_at ON customer_intelligence;
CREATE TRIGGER trg_customer_intelligence_updated_at BEFORE UPDATE ON customer_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS applied_recommendations (
  application_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intelligence_id     UUID REFERENCES customer_intelligence (intelligence_id) ON DELETE SET NULL,
  brand_id            UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  recommendation_text TEXT NOT NULL,
  action_taken        TEXT,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome_notes       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applied_recommendations_brand_id
  ON applied_recommendations (brand_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_applied_recommendations_intelligence_id
  ON applied_recommendations (intelligence_id);

DROP TRIGGER IF EXISTS trg_applied_recommendations_updated_at ON applied_recommendations;
CREATE TRIGGER trg_applied_recommendations_updated_at BEFORE UPDATE ON applied_recommendations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
