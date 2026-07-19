-- Sage V2 Phase 6 (Milestone 6): channel scorecards + honest forecasts +
-- Executive Debate + Top-3-bets strategy + self-evaluation scorecard.
-- Additive only; all runtime behavior is behind SAGE_V2_SCORECARDS /
-- SAGE_V2_FORECASTS / SAGE_V2_STRATEGY / SAGE_V2_SELF_EVAL (default OFF),
-- so these tables stay dormant until enabled.
-- See SAGE_V2_PHASE6_ARCHITECTURE.md (approved July 19, 2026, incl. the CEO
-- bet-structure refinement: objective / expected_timeframe / primary_kpi /
-- success_threshold / review_date required per bet — enforced at the write
-- chokepoint in utils/sageStrategy.js; JSONB cannot express it as a CHECK).
-- No uuid[] arrays (house rule): sage_strategy_bet_opportunities junction.

-- --- Channel scorecards (§4): deterministic cache, recomputable any time ------
-- metrics JSONB: per-metric values or null + reason codes (null-not-zero).
CREATE TABLE IF NOT EXISTS sage_channel_scorecards (
  scorecard_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  week_start    DATE NOT NULL,
  metrics       JSONB NOT NULL,
  source_row_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_sage_scorecard UNIQUE (brand_id, channel, week_start)
);

CREATE INDEX IF NOT EXISTS idx_sage_scorecards_brand
  ON sage_channel_scorecards (brand_id, week_start DESC);

-- --- Forecasts (§5): deterministic ranges; never stored below 8 weeks ---------
-- basis JSONB: { method, weeks_of_history, variance_observed, assumptions[] }.
CREATE TABLE IF NOT EXISTS sage_forecasts (
  forecast_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  metric        TEXT NOT NULL,
  horizon_weeks INTEGER NOT NULL DEFAULT 4,
  low           NUMERIC NOT NULL,
  expected      NUMERIC NOT NULL,
  high          NUMERIC NOT NULL,
  basis         JSONB NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_forecasts_metric_chk CHECK (
    metric IN ('leads', 'spend', 'cost_per_lead', 'conversions')
  ),
  CONSTRAINT sage_forecasts_band_chk CHECK (low <= expected AND expected <= high),
  CONSTRAINT uniq_sage_forecast UNIQUE (brand_id, metric, horizon_weeks)
);

-- --- Top-3-bets strategy object (§7) -------------------------------------------
-- bets JSONB: up to 3 of { title, thesis, objective, expected_timeframe,
-- primary_kpi, success_threshold, review_date, opportunity_refs } — all five
-- refinement fields REQUIRED (write chokepoint). options_considered is the
-- Executive Debate output, write-once (guarded in code — single write path).
CREATE TABLE IF NOT EXISTS sage_strategies (
  strategy_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  bets          JSONB NOT NULL,
  budget_line   JSONB,
  options_considered JSONB,
  status        TEXT NOT NULL DEFAULT 'draft',
  origin        TEXT NOT NULL DEFAULT 'ai_draft',
  review_at     TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ,
  owner_note    TEXT,
  superseded_by UUID REFERENCES sage_strategies (strategy_id) ON DELETE SET NULL,
  input_hash    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_strategies_status_chk CHECK (
    status IN ('draft', 'proposed', 'approved', 'declined', 'superseded', 'archived')
  ),
  CONSTRAINT sage_strategies_origin_chk CHECK (origin IN ('ai_draft', 'owner_revision'))
);

CREATE INDEX IF NOT EXISTS idx_sage_strategies_brand
  ON sage_strategies (brand_id, created_at DESC);

-- At most ONE live (proposed-or-approved) strategy per brand; supersede
-- happens atomically in one transaction (never two live strategies).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sage_strategies_live
  ON sage_strategies (brand_id)
  WHERE status IN ('proposed', 'approved');

-- --- Bet evidence junction (§8: no evidence, no bet; no uuid[] arrays) --------
CREATE TABLE IF NOT EXISTS sage_strategy_bet_opportunities (
  strategy_id    UUID NOT NULL REFERENCES sage_strategies (strategy_id) ON DELETE CASCADE,
  bet_index      INTEGER NOT NULL,
  opportunity_id UUID NOT NULL REFERENCES sage_opportunities (opportunity_id) ON DELETE RESTRICT,
  PRIMARY KEY (strategy_id, bet_index, opportunity_id),
  CONSTRAINT sage_bet_index_chk CHECK (bet_index >= 0 AND bet_index <= 2)
);

CREATE INDEX IF NOT EXISTS idx_sage_bet_opps_opportunity
  ON sage_strategy_bet_opportunities (opportunity_id);

-- --- Executive Debate (§6): immutable option sets; monthly-cap count index ----
CREATE TABLE IF NOT EXISTS sage_debates (
  debate_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  strategy_id   UUID REFERENCES sage_strategies (strategy_id) ON DELETE SET NULL,
  trigger_event TEXT NOT NULL,
  options       JSONB NOT NULL,
  chosen_option TEXT,
  input_hash    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_debates_trigger_chk CHECK (
    trigger_event IN ('new_strategy', 'budget_change', 'quarterly_review')
  )
);

CREATE INDEX IF NOT EXISTS idx_sage_debates_brand_month
  ON sage_debates (brand_id, created_at DESC);

-- --- Self-evaluation scorecard (§11–12): deterministic cache ------------------
-- aggregates JSONB: integer counts + cents only; denominators always stated.
CREATE TABLE IF NOT EXISTS sage_self_eval (
  eval_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  period       TEXT NOT NULL,
  aggregates   JSONB NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_sage_self_eval UNIQUE (brand_id, period)
);

-- updated_at trigger (house pattern) — only sage_strategies mutates in place.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_strategies_set_updated_at') THEN
    CREATE TRIGGER sage_strategies_set_updated_at
      BEFORE UPDATE ON sage_strategies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
