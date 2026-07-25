-- ============================================================================
-- EchoAI - Migration 009: Admin roles
-- ----------------------------------------------------------------------------
-- Adds a role to every user so the platform can distinguish customers from
-- administrators (James). Defaults to 'user'; admins are created by the admin
-- seeder or promoted manually.
--
-- Run with:  psql "$DATABASE_URL" -f models/009_admin_roles.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('user', 'admin');
    END IF;
END$$;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

COMMIT;
