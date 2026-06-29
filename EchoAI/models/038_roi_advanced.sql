-- Migration 038: Advanced ROI snapshots (multi-channel dollar attribution)
--
-- roi_advanced_snapshots stores one row per brand per reporting period capturing
-- the full advanced ROI picture: real spend and revenue totals plus the complete
-- per-channel breakdown (Facebook ads, phone, SMS, email, website) and the AI
-- ROI Analyst's executive summary. The Monday scheduler writes one row per active
-- brand per week so the Advanced ROI Dashboard has a running history to read back,
-- and the "regenerate analysis" action upserts the current period's row.
--
-- Distinct from roi_snapshots (019), which holds the simpler weekly value-model
-- estimate used by the basic ROI view. This table is the Enterprise feature.

CREATE TABLE IF NOT EXISTS roi_advanced_snapshots (
  snapshot_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  total_spend        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_revenue      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_leads        INTEGER NOT NULL DEFAULT 0,
  total_conversions  INTEGER NOT NULL DEFAULT 0,
  total_appointments INTEGER NOT NULL DEFAULT 0,
  roi_percentage     NUMERIC(10, 2),
  channel_breakdown  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_analysis        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_roi_advanced_snapshots_brand_id
  ON roi_advanced_snapshots (brand_id);
CREATE INDEX IF NOT EXISTS idx_roi_advanced_snapshots_period_end
  ON roi_advanced_snapshots (brand_id, period_end DESC);

DROP TRIGGER IF EXISTS trg_roi_advanced_snapshots_updated_at ON roi_advanced_snapshots;
CREATE TRIGGER trg_roi_advanced_snapshots_updated_at BEFORE UPDATE ON roi_advanced_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
