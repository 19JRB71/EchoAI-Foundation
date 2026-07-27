-- Prompt 003: create the actual Facebook ad object in both launch paths.
-- The campaigns table already links facebook_campaign_id + facebook_adset_id
-- (003_facebook_campaign.sql). A deliverable chain needs two more links:
--   facebook_creative_id — the ad creative created from the Page + link
--   facebook_ad_id       — the ad object (adset_id + creative), created PAUSED
-- Additive only.
ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS facebook_creative_id TEXT;
ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS facebook_ad_id TEXT;
