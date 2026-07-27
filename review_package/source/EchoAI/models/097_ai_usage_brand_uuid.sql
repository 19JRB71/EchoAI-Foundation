-- 097: ai_usage_log.brand_id must be UUID, matching brands.brand_id.
--
-- 096 created it as INTEGER by mistake, which made every join/lookup against
-- brands fail with "operator does not exist: uuid = integer" (admin AI status
-- usage summary, per-brand budget checks). No data can be lost by this change:
-- real brand ids are UUIDs, so a non-null integer value could never have been
-- written (the insert itself would have errored) — the column is all NULLs.

ALTER TABLE ai_usage_log
  ALTER COLUMN brand_id TYPE UUID USING NULL;
