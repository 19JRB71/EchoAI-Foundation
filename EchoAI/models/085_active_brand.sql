-- Brand-isolated dashboard: remember which brand the owner was last working on
-- so login can restore it ("Welcome back — last time you were on Blacor Homes").
-- Nullable; ownership is enforced in app code on every write (join to brands on
-- user_id), so no FK is needed and deleting a brand can leave a harmless stale
-- id that the client ignores when it's not in the brand list.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_brand_id UUID;
