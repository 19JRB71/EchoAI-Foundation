-- 078: tag automated social posts with a source key so automations can dedup
-- against THEIR OWN output only (never suppressed by manual/other posts), and
-- so overlapping scheduler ticks can't double-schedule the same slot.
--
-- source stays NULL for manual/user-created posts (NULLs never collide in the
-- unique index), and holds a slot key like 're_auto:2026-07-08:1' for the Nova
-- real-estate content runs — one post per brand/platform/slot/day, enforced by
-- the database itself (ON CONFLICT DO NOTHING at the insert site).

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS source VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_brand_platform_source
    ON social_posts (brand_id, platform, source)
    WHERE source IS NOT NULL;
