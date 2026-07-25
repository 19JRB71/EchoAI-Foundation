-- One demo brand per tier, per owner. Backstops the (transactional, delete-then-
-- reinsert) demo seeder against a concurrent double-seed creating duplicate demo
-- brands for the same tier. Partial index: only demo brands with a tier tag are
-- constrained; real brands (demo_tier IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_demo_brand_per_tier
  ON brands (user_id, demo_tier)
  WHERE is_demo = true AND demo_tier IS NOT NULL;
