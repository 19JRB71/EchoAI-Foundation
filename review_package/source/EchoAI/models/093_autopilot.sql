-- Autopilot Mode ("the captain approves, the crew executes").
--
-- The owner sets a weekly cadence once (N posts + N test ads per week) plus
-- hard ad-spend limits (daily / weekly / monthly). Every Monday the autopilot
-- engine drafts the week's batch — posts WITH on-brand graphics and fully
-- drafted test ads — from the brand's real intelligence. NOTHING publishes or
-- spends until the owner approves each item (by voice or click). Approving a
-- post copies it into the normal social_posts pipeline; approving an ad
-- launches a Facebook campaign ONLY if it fits inside every spend limit.
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS autopilot_settings (
  brand_id          UUID PRIMARY KEY REFERENCES brands (brand_id) ON DELETE CASCADE,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  posts_per_week    INTEGER NOT NULL DEFAULT 5 CHECK (posts_per_week BETWEEN 0 AND 21),
  ads_per_week      INTEGER NOT NULL DEFAULT 1 CHECK (ads_per_week BETWEEN 0 AND 7),
  -- Hard ad-spend ceilings in dollars; NULL = no limit set for that window.
  daily_spend_cap   NUMERIC(10,2) CHECK (daily_spend_cap   IS NULL OR daily_spend_cap   >= 0),
  weekly_spend_cap  NUMERIC(10,2) CHECK (weekly_spend_cap  IS NULL OR weekly_spend_cap  >= 0),
  monthly_spend_cap NUMERIC(10,2) CHECK (monthly_spend_cap IS NULL OR monthly_spend_cap >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autopilot_batches (
  batch_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  week_start DATE NOT NULL,               -- Monday of the ISO week this batch covers
  status     TEXT NOT NULL DEFAULT 'generating',
             -- generating | ready | completed | cancelled | failed
  error      TEXT,                        -- honest failure reason when status = 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One batch per brand per week: the atomic claim overlapping cron ticks race on.
  CONSTRAINT uq_autopilot_batches_brand_week UNIQUE (brand_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_autopilot_batches_user
  ON autopilot_batches (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS autopilot_batch_items (
  item_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES autopilot_batches (batch_id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,       -- review order (1-based, posts then ads)
  item_type       TEXT NOT NULL CHECK (item_type IN ('post', 'ad')),
  platform        TEXT,                   -- posts: facebook|twitter|linkedin; ads: facebook
  post_content    TEXT NOT NULL,          -- post copy, or the ad's primary text
  visual_idea     TEXT,                   -- one-sentence image brief (spoken to the owner)
  image_prompt    TEXT,                   -- engineered DALL-E prompt (set at render time)
  image_url       TEXT,                   -- permanent /uploads/images/... once rendered
  scheduled_time  TIMESTAMPTZ,            -- posts: proposed publish instant (UTC)
  rationale       TEXT,                   -- why Echo drafted this, grounded in real data
  ad_headline     TEXT,                   -- ads only
  ad_daily_budget NUMERIC(10,2),          -- ads only: proposed daily budget (dollars)
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- pending | approved | declined
  posted_post_id  UUID REFERENCES social_posts (post_id) ON DELETE SET NULL,
  campaign_id     UUID REFERENCES campaigns (campaign_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autopilot_batch_items_batch
  ON autopilot_batch_items (batch_id, position);

-- updated_at triggers (same convention as the rest of the schema)
DROP TRIGGER IF EXISTS trg_autopilot_settings_updated_at ON autopilot_settings;
CREATE TRIGGER trg_autopilot_settings_updated_at BEFORE UPDATE ON autopilot_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_autopilot_batches_updated_at ON autopilot_batches;
CREATE TRIGGER trg_autopilot_batches_updated_at BEFORE UPDATE ON autopilot_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_autopilot_batch_items_updated_at ON autopilot_batch_items;
CREATE TRIGGER trg_autopilot_batch_items_updated_at BEFORE UPDATE ON autopilot_batch_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
