-- Migration 017: Facebook OAuth connection flow
--
-- (1) PostgreSQL session store for connect-pg-simple, so OAuth `state` (CSRF
--     token) and the initiating user survive server restarts during the
--     redirect round-trip to Facebook.
-- (2) A JSONB column on api_integrations to store the list of Facebook ad
--     accounts returned by the Graph API at connect time (the selected account
--     id continues to live in account_ref).

-- (1) connect-pg-simple session table (default table name "session").
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS = FALSE);

-- Add the primary key only if it isn't already present (idempotent re-runs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
  ) THEN
    ALTER TABLE "session"
      ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- (2) Store the connected Facebook ad accounts as JSON.
ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS facebook_ad_accounts JSONB;
