-- 063_analytics_ctr.sql
-- Adds click/impression/click-through-rate columns to the weekly analytics table
-- so affiliate brands can track a real click-through-rate goal and Atlas can
-- optimize toward it. Cost per acquisition is derived from existing columns
-- (total_spend / conversions) and needs no new column. All idempotent.

ALTER TABLE analytics
  ADD COLUMN IF NOT EXISTS clicks INTEGER CHECK (clicks >= 0);

ALTER TABLE analytics
  ADD COLUMN IF NOT EXISTS impressions INTEGER CHECK (impressions >= 0);

ALTER TABLE analytics
  ADD COLUMN IF NOT EXISTS ctr NUMERIC(7, 4) CHECK (ctr >= 0);
