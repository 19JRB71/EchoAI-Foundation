-- 057_capital_funding.sql
-- Part 4: Opportunity & Capital Intelligence (Scout).
--
-- Scout weekly scans funding sources (federal / SBA / USDA / State of Florida /
-- private foundations) and business opportunities (market trends, competitor
-- weaknesses, partnerships, trending topics); Echo drafts complete grant
-- applications. This migration adds the three tables that persistence needs:
--   * funding_opportunities — every funding program Scout surfaces for a brand,
--     with a fit/impact/probability read and an apply/consider/skip call.
--   * grant_applications    — Echo's drafted applications + their pipeline status.
--   * opportunity_briefings — the weekly ranked opportunity briefing snapshot.
-- All idempotent (IF NOT EXISTS).

-- --- funding opportunities Scout has surfaced -------------------------------
CREATE TABLE IF NOT EXISTS funding_opportunities (
  opportunity_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  source            TEXT NOT NULL,          -- Federal | SBA | USDA | Florida | Foundation | Other
  name              TEXT NOT NULL,
  award_amount      TEXT,                   -- display string, e.g. "$10,000–$50,000"
  amount_max        NUMERIC(14,2),          -- parsed upper bound for sorting (nullable)
  deadline          DATE,                   -- nullable when rolling / unknown
  deadline_text     TEXT,                   -- "Rolling", "Annual (verify)", etc.
  eligibility       TEXT NOT NULL,
  description       TEXT NOT NULL,
  recommendation    TEXT NOT NULL DEFAULT 'consider', -- apply | consider | skip
  rationale         TEXT NOT NULL,
  fit_score         INTEGER NOT NULL DEFAULT 5,  -- 1-10
  impact_score      INTEGER NOT NULL DEFAULT 5,  -- 1-10
  probability_score INTEGER NOT NULL DEFAULT 5,  -- 1-10
  priority_score    NUMERIC(6,2) NOT NULL DEFAULT 0, -- impact * probability, for ranking
  official_url      TEXT,
  status            TEXT NOT NULL DEFAULT 'identified', -- identified | dismissed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_opps_brand
  ON funding_opportunities (brand_id, priority_score DESC);

-- Dedup so the weekly scan refreshes an existing program in place rather than
-- inserting a duplicate every week. Same program = same (brand, source, name).
CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_opps_brand_name
  ON funding_opportunities (brand_id, source, lower(name));

-- --- grant applications Echo has drafted ------------------------------------
CREATE TABLE IF NOT EXISTS grant_applications (
  application_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  opportunity_id  UUID REFERENCES funding_opportunities(opportunity_id) ON DELETE SET NULL,
  grant_name      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft', -- draft | in_progress | submitted | awarded | declined
  draft_summary   TEXT,
  draft_sections  JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ heading, content }]
  award_amount    TEXT,
  deadline        DATE,
  notes           TEXT,
  submitted_at    TIMESTAMPTZ,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grant_apps_brand
  ON grant_applications (brand_id, created_at DESC);

-- One draft per surfaced opportunity (re-drafting updates the row in place).
CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_apps_opportunity
  ON grant_applications (opportunity_id) WHERE opportunity_id IS NOT NULL;

-- --- weekly ranked opportunity briefing snapshot ---------------------------
CREATE TABLE IF NOT EXISTS opportunity_briefings (
  briefing_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id               UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  week_date              DATE NOT NULL,
  summary                TEXT NOT NULL,
  opportunities          JSONB NOT NULL DEFAULT '[]'::jsonb, -- ranked business opportunities
  competitor_weaknesses  JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_trends          JSONB NOT NULL DEFAULT '[]'::jsonb,
  partnerships           JSONB NOT NULL DEFAULT '[]'::jsonb,
  trending_topics        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, week_date)
);

CREATE INDEX IF NOT EXISTS idx_opp_briefings_brand
  ON opportunity_briefings (brand_id, week_date DESC);
