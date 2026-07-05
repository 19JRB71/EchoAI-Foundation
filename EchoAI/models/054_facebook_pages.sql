-- Migration 054: Facebook Page selection for the Setup Wizard
--
-- The OAuth connect flow already stores the user's ad accounts
-- (facebook_ad_accounts JSONB, selected id in account_ref). Running real,
-- deliverable ads also requires a Facebook Page. The Setup Wizard lets the
-- owner pick which Page represents this business, so we persist:
--   (1) facebook_pages  — the list of Pages the user manages (id, name, etc.)
--   (2) page_ref        — the id of the Page the owner selected.
-- Both mirror the ad-account columns and are backfilled on connect.

ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS facebook_pages JSONB;

ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS page_ref TEXT;
