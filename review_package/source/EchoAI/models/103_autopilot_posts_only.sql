-- Autopilot is Nova's content desk: posts only (product decision, July 2026).
-- Ads are Atlas's job via Ad Campaigns. Zero out any stored ads-per-week so
-- the Monday cron stops drafting test ads for existing brands. The ads
-- columns, ad approval flow, and spend caps stay — legacy pending ad items
-- remain reviewable and the caps still gate every ad approval.
UPDATE autopilot_settings SET ads_per_week = 0 WHERE ads_per_week <> 0;
