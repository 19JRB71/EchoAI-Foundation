-- Forge Creative Director engine: every piece of content starts from a
-- strategy brief (objective + emotional tone + visual style + camera + copy
-- style + time-of-day theme). Briefs are Forge's creative memory: recent rows
-- steer new picks AWAY from repetition, and rows linked to published posts
-- feed performance learning (which combinations actually engage).

CREATE TABLE IF NOT EXISTS forge_creative_briefs (
  brief_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  item_id      UUID REFERENCES autopilot_batch_items (item_id) ON DELETE SET NULL,
  objective    TEXT NOT NULL,
  tone         TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  camera       TEXT NOT NULL,
  copy_style   TEXT NOT NULL,
  time_slot    TEXT,          -- morning | afternoon | evening
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_briefs_brand
  ON forge_creative_briefs (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forge_briefs_item
  ON forge_creative_briefs (item_id);
