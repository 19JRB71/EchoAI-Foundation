-- Migration 018: Google integration + SEO tools
--
-- (1) google_integrations: stores a customer's Google OAuth tokens (encrypted)
--     for Business Profile / Ads / Analytics / Search Console. User-scoped with
--     one grant per user (UNIQUE user_id), mirroring how Facebook OAuth is
--     stored, but in a dedicated table because api_integrations has a fixed
--     platform enum + UNIQUE(user_id, platform).
-- (2) seo_content: brand-scoped saved AI-generated SEO content packages.

-- (1) Google OAuth tokens (encrypted at rest).
CREATE TABLE IF NOT EXISTS google_integrations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  google_account_email    TEXT,
  access_token_encrypted  TEXT,
  refresh_token_encrypted TEXT,
  scope                   TEXT,
  token_expiry            TIMESTAMPTZ,
  connection_status       TEXT NOT NULL DEFAULT 'connected',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_google_integrations_user_id
  ON google_integrations (user_id);

DROP TRIGGER IF EXISTS trg_google_integrations_updated_at ON google_integrations;
CREATE TRIGGER trg_google_integrations_updated_at BEFORE UPDATE ON google_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- (2) Saved SEO content.
CREATE TABLE IF NOT EXISTS seo_content (
  content_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  keyword           TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  generated_content JSONB NOT NULL,
  seo_score         INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_content_brand_id ON seo_content (brand_id);

DROP TRIGGER IF EXISTS trg_seo_content_updated_at ON seo_content;
CREATE TRIGGER trg_seo_content_updated_at BEFORE UPDATE ON seo_content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
