-- Company Truth (Phase 1-2 of the chain-of-command spec).
--
-- Sage builds a versioned Company Intelligence Report from the brand's REAL
-- data. The customer must explicitly approve it (or edit it, or request more
-- research) before it becomes the authoritative "Company Truth" that other
-- departments may consume. Nothing is distributed while pending.
--
-- Lifecycle: generating -> pending_approval -> approved -> superseded
--            (generation failure deletes the claim row; a pending report may
--             be regenerated in place after a research request)

CREATE TABLE IF NOT EXISTS company_truth_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'generating',
  -- The full report: one key per spec section (identity, classification,
  -- products, serviceArea, targetCustomers, businessModel, pricing, values,
  -- strengths, competitors, terminology, excludedCategories, reputation,
  -- assets, currentMarketing, opportunities, threats, missingInformation).
  report JSONB,
  -- Plain-language summary Sage presents to the customer.
  plain_summary TEXT,
  -- Which REAL data sources fed the report, incl. ones that were unavailable
  -- (probe failed -> recorded honestly as unavailable, never fabricated).
  sources JSONB,
  -- Owner's outstanding "request additional research" note (consumed by the
  -- next regeneration).
  research_request TEXT,
  -- Owner section edits made before approval (audit trail of {section, at}).
  edit_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_truth_status_chk CHECK (
    status IN ('generating', 'pending_approval', 'approved', 'superseded')
  ),
  UNIQUE (brand_id, version)
);

-- At most ONE in-flight generation and ONE pending report per brand; at most
-- ONE approved Truth per brand (older approvals become superseded atomically).
CREATE UNIQUE INDEX IF NOT EXISTS company_truth_one_generating
  ON company_truth_reports (brand_id) WHERE status = 'generating';
CREATE UNIQUE INDEX IF NOT EXISTS company_truth_one_pending
  ON company_truth_reports (brand_id) WHERE status = 'pending_approval';
CREATE UNIQUE INDEX IF NOT EXISTS company_truth_one_approved
  ON company_truth_reports (brand_id) WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS company_truth_brand_idx
  ON company_truth_reports (brand_id, version DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'company_truth_reports_set_updated_at'
  ) THEN
    CREATE TRIGGER company_truth_reports_set_updated_at
      BEFORE UPDATE ON company_truth_reports
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
