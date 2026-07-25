-- 109: Sage — Pattern Intelligence Engine (PIE)
--
-- Sage studies PUBLICLY AVAILABLE marketing in each brand's industry (Meta Ad
-- Library via the same real plumbing Competitor Ad Spy uses, plus live web
-- research) to learn WHY campaigns work — never to copy anyone. Two tables:
--
--   * sage_pattern_campaigns — one row per analyzed public campaign (deduped on
--     the Ad Library archive id per brand). `analysis` holds the AI's honest
--     classification of the ad's REAL text (hook type, emotions, copy traits).
--     Commercial Ad Library rows expose NO engagement metrics and NO media, so
--     nothing here ever claims engagement or visual data we don't have.
--
--   * sage_pattern_insights — the rolling per-brand intelligence report:
--     industry-wide patterns (aggregated in code from the analyzed rows +
--     cited live web research) and the Creative Brief handed to Forge.
--
-- Run claims reuse sage_research_runs (cycle_type 'patterns', weekly run_key).

CREATE TABLE IF NOT EXISTS sage_pattern_campaigns (
  campaign_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  ad_archive_id  TEXT NOT NULL,
  page_name      TEXT,
  headline       TEXT,
  body           TEXT,
  cta            TEXT,
  snapshot_url   TEXT,          -- LINK to the public Ad Library snapshot
  platforms      JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_start DATE,
  analysis       JSONB,         -- null until analyzed; see patternIntelligencePrompt
  analyzed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, ad_archive_id)
);

CREATE INDEX IF NOT EXISTS idx_pattern_campaigns_brand_unanalyzed
  ON sage_pattern_campaigns (brand_id, created_at DESC)
  WHERE analysis IS NULL;

CREATE TABLE IF NOT EXISTS sage_pattern_insights (
  brand_id      UUID PRIMARY KEY REFERENCES brands (brand_id) ON DELETE CASCADE,
  industry      TEXT,
  sample_size   INTEGER NOT NULL DEFAULT 0,   -- real count of analyzed campaigns
  report        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{pattern, evidence, why_it_works}]
  forge_brief   JSONB,                        -- Creative Brief for Forge (or null)
  sources       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- real web citations
  last_run_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
