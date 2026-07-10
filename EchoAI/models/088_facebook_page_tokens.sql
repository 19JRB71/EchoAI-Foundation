-- Unified Facebook connection: one OAuth login now serves BOTH Atlas (ads) and
-- Nova (organic Page posting). Publishing to a Page feed needs a per-Page access
-- token (distinct from the user token used for ads), so the OAuth callback now
-- captures those Page tokens and stores them here — encrypted, never returned to
-- the client. A brand's social_accounts row records only WHICH Page it posts to;
-- the token is resolved live from this column at publish time, so it is the
-- single source of truth and can never go stale.
ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS facebook_page_tokens TEXT;
