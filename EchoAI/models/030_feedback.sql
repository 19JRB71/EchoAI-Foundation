-- ============================================================================
-- Migration 030: Customer Feedback & Survey System
-- Surveys (AI-generated question sets), individual responses (with a 1-10
-- sentiment score), and periodic AI feedback-analysis reports. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS surveys (
    survey_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    survey_type  VARCHAR(32) NOT NULL,
    questions    JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surveys_brand_id ON surveys (brand_id);
CREATE INDEX IF NOT EXISTS idx_surveys_type ON surveys (brand_id, survey_type);

-- A row is created at send time (answers NULL = "sent, awaiting response") and
-- filled in when the customer responds, so response rate = answered / sent.
CREATE TABLE IF NOT EXISTS survey_responses (
    response_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id        UUID NOT NULL REFERENCES surveys (survey_id) ON DELETE CASCADE,
    brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    lead_id          UUID REFERENCES leads (lead_id) ON DELETE SET NULL,
    respondent_email VARCHAR(255),
    respondent_phone VARCHAR(50),
    answers          JSONB,
    sentiment_score  INTEGER CHECK (sentiment_score BETWEEN 1 AND 10),
    responded_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_brand_id ON survey_responses (brand_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON survey_responses (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_created_at ON survey_responses (brand_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_reports (
    report_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id             UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    analysis_period_start TIMESTAMPTZ NOT NULL,
    analysis_period_end   TIMESTAMPTZ NOT NULL,
    total_responses      INTEGER NOT NULL DEFAULT 0,
    average_sentiment    NUMERIC(4, 2),
    themes               JSONB,
    recommendations      JSONB,
    full_report          TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_reports_brand_id ON feedback_reports (brand_id, created_at DESC);

-- set_updated_at() is defined in an earlier migration; reuse it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_surveys_updated_at') THEN
    CREATE TRIGGER trg_surveys_updated_at BEFORE UPDATE ON surveys
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_survey_responses_updated_at') THEN
    CREATE TRIGGER trg_survey_responses_updated_at BEFORE UPDATE ON survey_responses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feedback_reports_updated_at') THEN
    CREATE TRIGGER trg_feedback_reports_updated_at BEFORE UPDATE ON feedback_reports
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;
