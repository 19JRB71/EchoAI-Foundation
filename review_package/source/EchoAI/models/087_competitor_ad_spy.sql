-- Competitor Ad Spy (Scout, Enterprise)
--
-- Scout pulls each brand's CONFIRMED competitors (sage_competitors.status =
-- 'confirmed', migration 069) live ads from the Facebook Ad Library every 6h,
-- classifies brand-new ones with Hermes 4 (threat read), and delivers a weekly
-- Claude-written ad-intelligence report. No fabricated data: rows only exist for
-- ads actually returned by the Ad Library. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS competitor_ads (
  ad_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  competitor_id    UUID REFERENCES sage_competitors (competitor_id) ON DELETE SET NULL,
  competitor_name  TEXT NOT NULL,
  ad_archive_id    TEXT NOT NULL,           -- Facebook Ad Library ad id (dedup key)
  page_name        TEXT,
  headline         TEXT,
  body_text        TEXT,
  cta_text         TEXT,                    -- best-effort (Ad Library link caption); may be NULL
  snapshot_url     TEXT,                    -- link to the ad's Facebook snapshot (not raw media)
  platforms        TEXT[] NOT NULL DEFAULT '{}',  -- publisher_platforms
  delivery_start   DATE,                    -- ad_delivery_start_time (running-since)
  status           TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  threat_level     TEXT,                    -- Hermes read: none | watch | aggressive (NULL = unclassified)
  threat_reason    TEXT,
  owner_alerted_at TIMESTAMPTZ,             -- CAS marker: owner alerted once per aggressive ad
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: one row per (brand, Facebook ad). Re-scans UPDATE last_seen_at.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_ads_archive
  ON competitor_ads (brand_id, ad_archive_id);

CREATE INDEX IF NOT EXISTS idx_competitor_ads_brand_feed
  ON competitor_ads (brand_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS competitor_ad_reports (
  report_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  week_date        DATE NOT NULL,           -- Monday of the report week
  summary          TEXT NOT NULL,
  top_ads          JSONB NOT NULL DEFAULT '[]'::jsonb,
  gaps             JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One report per brand per week; a regenerate overwrites in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_ad_reports_week
  ON competitor_ad_reports (brand_id, week_date);
