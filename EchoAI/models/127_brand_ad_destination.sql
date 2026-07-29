-- 127: Per-brand Facebook Page and ad destination link (Prompt 004, D-20 Option C).
--
-- Ad launches previously resolved the Facebook Page from the user-scoped
-- api_integrations.page_ref and the destination link from the
-- FACEBOOK_LINK_URL environment variable — both global per account/deploy.
-- These columns make Page + link a per-brand decision so one owner can run
-- ads for multiple brands, each through its own Page to its own site.
--
-- Backfill (behavior-preserving, never overwrites an existing value):
--   * facebook_page_id copies the owner's current page_ref selection into
--     each of their brands, so every launch resolves exactly the Page it
--     resolved yesterday.
--   * ad_link_url copies the brand's own website_url where present (the env
--     link was a deploy-wide placeholder; the brand's site is the honest
--     per-brand equivalent).
--
-- Rollback:
--   ALTER TABLE brands DROP COLUMN IF EXISTS facebook_page_id;
--   ALTER TABLE brands DROP COLUMN IF EXISTS ad_link_url;

ALTER TABLE brands ADD COLUMN IF NOT EXISTS facebook_page_id TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS ad_link_url TEXT;

DO $$
DECLARE
  page_rows INTEGER;
  link_rows INTEGER;
BEGIN
  UPDATE brands b
  SET facebook_page_id = ai.page_ref
  FROM api_integrations ai
  WHERE ai.user_id = b.user_id
    AND ai.platform = 'facebook'
    AND ai.page_ref IS NOT NULL
    AND b.facebook_page_id IS NULL;
  GET DIAGNOSTICS page_rows = ROW_COUNT;

  UPDATE brands
  SET ad_link_url = website_url
  WHERE website_url IS NOT NULL
    AND ad_link_url IS NULL;
  GET DIAGNOSTICS link_rows = ROW_COUNT;

  RAISE NOTICE 'migration 127: backfilled facebook_page_id on % brand(s), ad_link_url on % brand(s)',
    page_rows, link_rows;
END $$;
