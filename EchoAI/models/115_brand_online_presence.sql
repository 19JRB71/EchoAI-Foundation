-- Brand online presence: the business's own website and Facebook page.
-- Collected during setup (Setup Agent interview) and editable in the Sage
-- Company Truth tab; Sage's Company Intelligence research reads both so the
-- report is grounded in the business's real online presence.

ALTER TABLE brands ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS facebook_page_url TEXT;
