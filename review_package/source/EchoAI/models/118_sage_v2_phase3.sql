-- Sage V2 Phase 3 (Milestone 3): outcome capture + attribution fields.
-- Additive only; all columns nullable so flags-off behavior is byte-identical.
-- See SAGE_V2_PHASE3_ARCHITECTURE.md.

-- Outcome capture (SAGE_V2_ARCHITECTURE.md §6): the measurement record.
-- leads.conversion_status remains the operational pipeline state; outcome is
-- one-way synced (converted -> won) and never drives behavior in Phase 3.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value_cents BIGINT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_source VARCHAR(30);

-- Attribution v2 (three fields, populated only by code paths that genuinely
-- know the value; never inferred retroactively — multi-touch is rejected).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_touch VARCHAR(40);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converting_touch VARCHAR(40);

-- Value constraints (guarded so re-runs are idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_outcome_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('won', 'lost', 'no_show', 'unqualified'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_outcome_source_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_outcome_source_check
      CHECK (outcome_source IS NULL OR outcome_source IN ('owner', 'voice', 'crm', 'autonomous', 'assumed_from_appointment'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_deal_value_cents_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_deal_value_cents_check
      CHECK (deal_value_cents IS NULL OR deal_value_cents >= 0);
  END IF;
END $$;

-- Coverage math scans per brand; partial index keeps it cheap without
-- taxing the (mostly outcome-less today) main table.
CREATE INDEX IF NOT EXISTS idx_leads_brand_outcome
  ON leads (brand_id) WHERE outcome IS NOT NULL;
