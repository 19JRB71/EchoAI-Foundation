-- 105_vision.sql
--
-- Vision — Zorecho's Visual Intelligence Agent (Phase 1).
--
-- Vision builds a growing per-brand visual knowledge base for the brand's
-- industry so Forge can create more realistic, higher-converting, completely
-- original marketing images. Phase 1 studies ONLY sources we legitimately
-- have: Scout's competitor Facebook ads (text + metadata already collected in
-- competitor_ads) and the brand's own Zorecho image library (images table),
-- distilled together with Claude's built-in industry expertise. Every study
-- run honestly records exactly which sources contributed and how many rows —
-- nothing is ever fabricated or claimed from sources we can't reach. The
-- source list is a registry in utils/visionEngine.js so future legitimate
-- sources (official APIs, customer-authorized connections) plug in without a
-- redesign. Idempotent (IF NOT EXISTS).

-- The rolling knowledge base: one row per brand, versioned; each study run
-- refines it (version + 1) rather than replacing history blindly.
CREATE TABLE IF NOT EXISTS vision_knowledge (
  knowledge_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  industry         TEXT NOT NULL,
  knowledge        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- structural_standards, composition, lighting, color_palettes, seasonal_trends, common_offers, emotions, quality_notes
  confidence       INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  version          INTEGER NOT NULL DEFAULT 1,
  sources_studied  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- honest per-source row counts from the LAST study run
  last_studied_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vision_knowledge_brand
  ON vision_knowledge (brand_id);

-- Study-run log: one row per attempt (daily sweep or manual "Study now").
CREATE TABLE IF NOT EXISTS vision_study_runs (
  run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled | manual
  status       TEXT NOT NULL DEFAULT 'running',     -- running | completed | failed
  sources      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-source row counts actually gathered
  summary      TEXT,                                -- what Vision learned this run (AI-written)
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vision_study_runs_brand
  ON vision_study_runs (brand_id, started_at DESC);

-- Guidance log: every time another agent (Forge) consults Vision before
-- creating an image — drives the "how Vision is improving Forge" stats.
CREATE TABLE IF NOT EXISTS vision_guidance_log (
  guidance_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  requester        TEXT NOT NULL,               -- forge_image_studio | forge_ad_studio
  request_summary  TEXT NOT NULL,
  knowledge_version INTEGER,                    -- version of the knowledge used
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vision_guidance_brand
  ON vision_guidance_log (brand_id, created_at DESC);
