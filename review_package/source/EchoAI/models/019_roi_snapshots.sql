-- Migration 019: Customer ROI snapshots
--
-- roi_snapshots stores one row per brand per ISO week capturing the value EchoAI
-- delivered that week. The Customer ROI Dashboard derives these from real
-- platform data (leads, campaigns, social posts, emails, analytics) and upserts
-- them so the 12-week trend chart has a persistent history to read back.

CREATE TABLE IF NOT EXISTS roi_snapshots (
  snapshot_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  week_date            DATE NOT NULL,
  total_leads          INTEGER NOT NULL DEFAULT 0,
  hot_leads            INTEGER NOT NULL DEFAULT 0,
  estimated_lead_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ad_spend_managed     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cost_per_lead        NUMERIC(12, 2),
  hours_saved          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  money_saved          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_roi_estimate   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, week_date)
);

CREATE INDEX IF NOT EXISTS idx_roi_snapshots_brand_id ON roi_snapshots (brand_id);
CREATE INDEX IF NOT EXISTS idx_roi_snapshots_week_date ON roi_snapshots (week_date);

DROP TRIGGER IF EXISTS trg_roi_snapshots_updated_at ON roi_snapshots;
CREATE TRIGGER trg_roi_snapshots_updated_at BEFORE UPDATE ON roi_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
