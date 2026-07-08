-- 079: Geographic targeting + exclusion zones
--
-- brands.geo_targeting JSONB shape (managed by utils/geoTargeting.js):
--   {
--     "areas":      [{ "type": "state|county|city|zip|radius", "value": "...",
--                      "state": "FL"?, "radiusMiles": 25? }],
--     "exclusions": [{ "type": "state|county|city|zip", "value": "...",
--                      "state": "FL"?, "reason": "..."?,
--                      "addedBy": "owner|sage", "addedAt": "ISO" }]
--   }
-- NULL / missing = no geographic restriction configured.

ALTER TABLE brands ADD COLUMN IF NOT EXISTS geo_targeting JSONB;

-- Lead location capture + compliance flag. geo_status is NULL when the lead's
-- location is unknown (never guessed): 'in_area' | 'out_of_area' | 'excluded'.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_city  VARCHAR(120);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_state VARCHAR(60);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_zip   VARCHAR(20);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS geo_status VARCHAR(20);
