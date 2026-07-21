-- Session invalidation on password change: tokens issued before this
-- timestamp are rejected by the auth middleware, so changing the password
-- locks out any previously issued (possibly stolen) login token.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
