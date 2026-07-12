-- 098: remaining id columns from 096 that were declared INTEGER but hold UUIDs
-- (users.user_id and brands.brand_id are UUID everywhere else in the schema).
-- 097 already fixed ai_usage_log.brand_id; this fixes the other two.
--
-- No data can be lost: a real UUID could never have been written into an
-- INTEGER column (the insert itself would have errored), so both columns are
-- all NULLs wherever this migration runs.

ALTER TABLE ai_usage_log
  ALTER COLUMN user_id TYPE UUID USING NULL;

ALTER TABLE ai_settings
  ALTER COLUMN updated_by TYPE UUID USING NULL;
