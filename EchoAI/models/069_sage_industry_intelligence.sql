-- 069_sage_industry_intelligence.sql
-- Sage — the Industry Intelligence Agent (EchoAI's 9th AI team member).
--
-- Sage studies each brand's industry around the clock using REAL live web search
-- (Anthropic's built-in web_search tool) so every other agent — and the owner's
-- morning briefing — always has the smartest possible, fully-cited strategy.
--
-- This migration adds the persistence Sage needs. Everything is idempotent
-- (IF NOT EXISTS) and every brand-scoped table cascades on brand delete.
--
--   * sage_intelligence_profiles — the rolling per-brand industry brief: seven
--     narrative sections + cited sources + actionable marketing insights, kept
--     fresh by the deep-research cycle.
--   * sage_intelligence_feed     — the reverse-chronological stream of discrete
--     findings (trend / competitor / regulation / opportunity / threat), each
--     with why-it-matters and an urgent flag for time-sensitive signals.
--   * sage_competitors           — the owner-confirmed competitor watch list Sage
--     tracks (followers / last post / ad activity / strategy read).
--   * sage_submissions           — the Intelligence Input history: links, FB
--     pages, images and PDFs the owner hands Sage to analyze.
--   * sage_alert_log             — dedup ledger so an urgent signal only ever
--     pages the owner once (per brand, per signal, per day).
--   * sage_research_runs         — atomic per-cycle claim ledger so overlapping
--     scheduler ticks can never double-run a brand's research.

-- --- the rolling per-brand industry brief -----------------------------------
CREATE TABLE IF NOT EXISTS sage_intelligence_profiles (
  brand_id            UUID PRIMARY KEY REFERENCES brands (brand_id) ON DELETE CASCADE,
  industry            TEXT,                                 -- Sage's read of the brand's industry
  summary             TEXT NOT NULL DEFAULT '',             -- one-paragraph executive read
  sections            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ key, title, body }] — the 7 narrative sections
  marketing_insights  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ insight, action, why }] actionable recommendations
  sources             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ title, url }] cited web sources
  last_refreshed_at   TIMESTAMPTZ,                          -- last successful deep-research completion
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --- the rolling stream of discrete findings --------------------------------
CREATE TABLE IF NOT EXISTS sage_intelligence_feed (
  feed_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL DEFAULT 'trend',           -- trend | competitor | regulation | opportunity | threat | market
  summary         TEXT NOT NULL,                           -- what Sage found
  why_it_matters  TEXT NOT NULL,                           -- why it matters to this brand
  url             TEXT,                                    -- primary cited source
  source_title    TEXT,                                    -- cited source title
  urgent          BOOLEAN NOT NULL DEFAULT FALSE,          -- time-sensitive signal
  signal_key      TEXT NOT NULL,                           -- stable dedup key for this finding
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_feed_brand
  ON sage_intelligence_feed (brand_id, created_at DESC);

-- Dedup so a recurring scan refreshes an existing finding in place rather than
-- inserting the same signal every cycle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_feed_signal
  ON sage_intelligence_feed (brand_id, signal_key);

-- --- the owner-confirmed competitor watch list ------------------------------
CREATE TABLE IF NOT EXISTS sage_competitors (
  competitor_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  website           TEXT,
  facebook_page     TEXT,
  follower_count    TEXT,                                  -- display string (e.g. "12.4K") — nullable when unknown
  last_post         TEXT,                                  -- last-observed post summary / recency
  ad_activity       TEXT,                                  -- recent ad activity read
  strategy_summary  TEXT,                                  -- Sage's read of their marketing strategy
  status            TEXT NOT NULL DEFAULT 'suggested',     -- suggested | confirmed | dismissed
  last_checked_at   TIMESTAMPTZ,                           -- last time Sage refreshed this competitor
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_competitors_brand
  ON sage_competitors (brand_id, status);

-- One row per competitor name per brand (re-suggesting updates in place).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_competitors_brand_name
  ON sage_competitors (brand_id, lower(name));

-- --- the Intelligence Input submission history ------------------------------
CREATE TABLE IF NOT EXISTS sage_submissions (
  submission_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users (user_id) ON DELETE SET NULL,
  input_type      TEXT NOT NULL,                           -- link | facebook | image | pdf
  input_ref       TEXT,                                    -- url or original filename
  title           TEXT,                                    -- short label for the history list
  summary         TEXT NOT NULL DEFAULT '',                -- Sage's analysis summary
  insights        JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{ insight, why }] extracted takeaways
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_submissions_brand
  ON sage_submissions (brand_id, created_at DESC);

-- --- urgent-alert dedup ledger ----------------------------------------------
-- Mirrors the api_quota_alert_log pattern: an urgent signal only pages the owner
-- once per (brand, signal, day) no matter how many 30-minute scans re-see it.
CREATE TABLE IF NOT EXISTS sage_alert_log (
  alert_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  signal_key   TEXT NOT NULL,
  alert_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, signal_key, alert_date)
);

-- --- atomic per-cycle claim ledger ------------------------------------------
-- The deep (6h) and urgent (30m) sweeps claim a brand's run by INSERT ... ON
-- CONFLICT DO NOTHING against a stable run_key; the tick that inserts the row
-- owns the run, so overlapping ticks can never double-run the same brand.
CREATE TABLE IF NOT EXISTS sage_research_runs (
  run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  cycle_type   TEXT NOT NULL,                              -- deep | urgent
  run_key      TEXT NOT NULL,                              -- e.g. deep:2026-07-06T12, urgent:2026-07-06T12:30
  status       TEXT NOT NULL DEFAULT 'running',            -- running | done | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, cycle_type, run_key)
);

CREATE INDEX IF NOT EXISTS idx_sage_runs_brand
  ON sage_research_runs (brand_id, created_at DESC);
