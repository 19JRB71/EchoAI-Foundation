-- Sage V2 Phase 1 (approved architecture: SAGE_V2_CHALLENGE_REVIEW.md).
-- Additive only; all functionality behind SAGE_V2_CONTEXT / SAGE_V2_WEEKLY_BRIEFING
-- flags (default OFF), so these tables stay dormant until enabled.

-- Per-brand "flying blind" counter: incremented whenever a department builds an
-- AI context while the brand has NO approved Company Truth. Surfaced on the Sage
-- page and via Echo's nudge so the owner knows their AI team is working without
-- vetted facts.
CREATE TABLE IF NOT EXISTS sage_context_stats (
  brand_id UUID PRIMARY KEY REFERENCES brands(brand_id) ON DELETE CASCADE,
  flying_blind_count INTEGER NOT NULL DEFAULT 0,
  last_flying_blind_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consolidated weekly Sage briefing: ONE customer-facing weekly output that
-- absorbs the overlapping Monday reports (Customer Intelligence, ROI snapshot,
-- autopilot run, competitor report, feedback). Claimed per ISO week so the
-- Monday stack can never double-build. Customer-facing wording ships as
-- placeholder copy (config/briefingCopy.js) pending the approved final copy.
CREATE TABLE IF NOT EXISTS sage_weekly_briefings (
  briefing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  iso_week VARCHAR(10) NOT NULL, -- e.g. 2026-W29
  status VARCHAR(20) NOT NULL DEFAULT 'generating',
  -- Ordered briefing sections: [{ key, title, body, source, available }]
  -- body text comes from real report rows or placeholder copy; sections whose
  -- source report is missing are recorded honestly as available=false.
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Which source reports fed (or were missing from) this briefing.
  sources JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_weekly_briefing_status_chk CHECK (
    status IN ('generating', 'ready', 'failed')
  ),
  UNIQUE (brand_id, iso_week)
);

CREATE INDEX IF NOT EXISTS sage_weekly_briefings_brand_idx
  ON sage_weekly_briefings (brand_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sage_context_stats_set_updated_at'
  ) THEN
    CREATE TRIGGER sage_context_stats_set_updated_at
      BEFORE UPDATE ON sage_context_stats
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sage_weekly_briefings_set_updated_at'
  ) THEN
    CREATE TRIGGER sage_weekly_briefings_set_updated_at
      BEFORE UPDATE ON sage_weekly_briefings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
