-- Competitor Website Analysis (Scout, Enterprise) — migration 089
--
-- Owners manually add competitor WEBSITE URLs per brand. Scout reads each site
-- with Anthropic's web_fetch tool and stores a structured analysis (pricing/
-- offers, messaging/positioning, products/services, CTAs/promos, plus a summary).
-- A daily sweep re-reads each tracked URL and records only MEANINGFUL changes
-- (price/offer/messaging/redesign) — cosmetic edits are ignored. Sites that block
-- automated reading get an explicit 'error' status + last_error (honest: never a
-- fabricated analysis). Strictly brand-scoped; removing a site (DELETE) cascades
-- its changes and stops monitoring. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS competitor_websites (
  site_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  url               TEXT NOT NULL,            -- owner-entered, normalized (https, public host)
  label             TEXT,                     -- optional friendly name for the competitor
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | analyzed | error
  last_error        TEXT,                     -- honest "couldn't read this site" reason (NULL when ok)
  -- Latest structured analysis snapshot (also mirrored in `analysis` JSONB for diffing).
  pricing           TEXT,
  offers            TEXT,
  messaging         TEXT,
  products          TEXT,
  ctas              TEXT,
  positioning       TEXT,
  summary           TEXT,
  analysis          JSONB,                    -- full structured snapshot, used to detect changes
  last_checked_at   TIMESTAMPTZ,              -- last time a check ran (atomic claim marker)
  last_analyzed_at  TIMESTAMPTZ,              -- last time analysis actually succeeded
  last_changed_at   TIMESTAMPTZ,              -- last meaningful change detected
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: one row per (brand, normalized URL). Prevents tracking the same site twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_websites_url
  ON competitor_websites (brand_id, url);

CREATE INDEX IF NOT EXISTS idx_competitor_websites_brand
  ON competitor_websites (brand_id, status);

-- Powers the scheduled sweep's "due for re-check" scan.
CREATE INDEX IF NOT EXISTS idx_competitor_websites_checked
  ON competitor_websites (last_checked_at);

CREATE TABLE IF NOT EXISTS competitor_website_changes (
  change_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES competitor_websites (site_id) ON DELETE CASCADE,
  brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  change_type       TEXT NOT NULL,            -- pricing | offer | messaging | products | cta | redesign
  summary           TEXT NOT NULL,            -- one plain-English sentence on what changed
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- before/after specifics
  change_key        TEXT NOT NULL,            -- dedup key (type + normalized summary) per site
  owner_alerted_at  TIMESTAMPTZ,             -- CAS marker: owner alerted once per change
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: the same change is never recorded (or alerted) twice for one site, even
-- if two sweep ticks overlap. The stored snapshot advancing after each check keeps
-- this effective across runs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_website_changes_key
  ON competitor_website_changes (site_id, change_key);

CREATE INDEX IF NOT EXISTS idx_competitor_website_changes_site
  ON competitor_website_changes (site_id, detected_at DESC);
