-- Competitor Website weekly digest (Scout, Enterprise) — migration 090
--
-- Scout already records MEANINGFUL per-site changes in competitor_website_changes
-- (migration 089). This table persists a WEEKLY ROLL-UP of those changes across a
-- brand's tracked sites ("3 competitors changed pricing, 1 launched a new offer
-- this week") so the owner gets one summary voice/push instead of one alert per
-- site. The digest CONTENT shown in the UI is always recomputed live from the
-- changes feed (never stale); this table exists only to persist the snapshot and
-- to guarantee the weekly voice/push summary fires AT MOST ONCE per brand per
-- ISO week (owner_alerted_at CAS). Honest: a week with no changes is never
-- persisted and never alerted — nothing is fabricated. Brand-scoped; removing a
-- brand cascades. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS competitor_website_digests (
  digest_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  week_date         DATE NOT NULL,            -- Monday (UTC) of the digest's ISO week
  headline          TEXT NOT NULL,            -- one plain-English roll-up sentence
  total_changes     INTEGER NOT NULL DEFAULT 0,
  sites_changed     INTEGER NOT NULL DEFAULT 0,
  stats             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-type distinct-competitor counts
  owner_alerted_at  TIMESTAMPTZ,             -- CAS marker: owner summarized once per week
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One digest row per (brand, ISO week): the weekly job upserts and the CAS on
-- owner_alerted_at makes the summary at-most-once even if two ticks overlap.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_website_digests_week
  ON competitor_website_digests (brand_id, week_date);

CREATE INDEX IF NOT EXISTS idx_competitor_website_digests_brand
  ON competitor_website_digests (brand_id, week_date DESC);
