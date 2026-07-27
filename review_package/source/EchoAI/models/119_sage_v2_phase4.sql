-- Sage V2 Phase 4 (Milestone 4): offers registry + business constraints +
-- Company Truth v2 expanded inputs + Executive Memory.
-- Additive only; all runtime behavior is behind SAGE_V2_OFFERS /
-- SAGE_V2_CONSTRAINTS / SAGE_V2_TRUTH_INPUTS / SAGE_V2_EXEC_MEMORY (default
-- OFF), so these tables and columns stay dormant until enabled.
-- See SAGE_V2_PHASE4_ARCHITECTURE.md.

-- --- Offer Intelligence (§10) ------------------------------------------------
-- Owner-managed registry of the brand's real offers. campaign_id is a forward
-- link only: NO performance rollups are computed in Phase 4 (deferred until
-- deterministic campaign attribution exists — CEO condition). margin_note is
-- owner-entered, owner-private, and NEVER enters customer-facing prompts.
CREATE TABLE IF NOT EXISTS sage_offers (
  offer_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  offer_type  TEXT NOT NULL,
  terms       TEXT,
  margin_note TEXT,           -- owner-private; excluded from customer-facing context
  starts_at   DATE,
  ends_at     DATE,
  status      TEXT NOT NULL DEFAULT 'active',
  campaign_id UUID,           -- forward link; unused in Phase 4 (no rollups)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_offers_type_chk CHECK (
    offer_type IN ('discount', 'financing', 'guarantee', 'bundle', 'lead_magnet', 'urgency')
  ),
  CONSTRAINT sage_offers_status_chk CHECK (status IN ('active', 'archived')),
  CONSTRAINT sage_offers_period_chk CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_sage_offers_brand
  ON sage_offers (brand_id, status, created_at DESC);

-- --- Business constraints (§11) ----------------------------------------------
-- One row per brand; every column nullable — NULL means "the owner has not
-- provided this", never a fabricated default. legal_notes / cash_flow_note are
-- owner-private (allowlist rule keeps them out of customer-facing prompts).
-- Service area stays in geo_targeting; owner preferences stay in echo_learnings.
CREATE TABLE IF NOT EXISTS brand_constraints (
  brand_id            UUID PRIMARY KEY REFERENCES brands (brand_id) ON DELETE CASCADE,
  monthly_budget_cents BIGINT,
  staff_count         INTEGER,
  weekly_capacity     INTEGER,
  blackout_dates      JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{from:'YYYY-MM-DD',to:'YYYY-MM-DD',label}]
  legal_notes         TEXT,   -- owner-private
  cash_flow_note      TEXT,   -- owner-private
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brand_constraints_budget_chk CHECK (
    monthly_budget_cents IS NULL OR monthly_budget_cents >= 0
  ),
  CONSTRAINT brand_constraints_staff_chk CHECK (
    staff_count IS NULL OR staff_count >= 0
  ),
  CONSTRAINT brand_constraints_capacity_chk CHECK (
    weekly_capacity IS NULL OR weekly_capacity >= 0
  )
);

-- --- Executive Memory (W9.3) ---------------------------------------------------
-- Owner-stated durable business facts, captured via Echo chat/voice (the only
-- source in Phase 4, so confidence is always 'verified'). AI never self-writes
-- a fact; writes are confirmation-gated in the capture path.
CREATE TABLE IF NOT EXISTS sage_memory (
  memory_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'owner_chat',
  confidence  TEXT NOT NULL DEFAULT 'verified',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_memory_kind_chk CHECK (
    kind IN ('operational_lesson', 'seasonal_lesson', 'vendor', 'local_insight', 'unwritten_rule', 'owner_context')
  ),
  CONSTRAINT sage_memory_source_chk CHECK (source IN ('owner_chat', 'owner_voice')),
  CONSTRAINT sage_memory_confidence_chk CHECK (confidence IN ('verified')),
  CONSTRAINT sage_memory_status_chk CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_sage_memory_brand
  ON sage_memory (brand_id, status, created_at DESC);

-- --- Company Truth v2 expanded inputs (§3b): online-presence URLs -------------
-- Extends migration 115's pattern (website_url, facebook_page_url).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS google_business_url TEXT;

-- updated_at triggers (house pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_offers_set_updated_at') THEN
    CREATE TRIGGER sage_offers_set_updated_at
      BEFORE UPDATE ON sage_offers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'brand_constraints_set_updated_at') THEN
    CREATE TRIGGER brand_constraints_set_updated_at
      BEFORE UPDATE ON brand_constraints
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_memory_set_updated_at') THEN
    CREATE TRIGGER sage_memory_set_updated_at
      BEFORE UPDATE ON sage_memory
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
