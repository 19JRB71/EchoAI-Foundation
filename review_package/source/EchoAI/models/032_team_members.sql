-- ============================================================================
-- EchoAI - Migration 032: Team members & invitations
-- ----------------------------------------------------------------------------
-- Adds workspace team membership so an account owner can invite staff, assign a
-- role (viewer / manager / admin), and control access. Invitations carry a
-- secure one-time token that expires in 48 hours.
--
-- Seat billing reuses the existing per-seat logic on `users.team_size`: the
-- owner is seat #1 and each ACTIVE member adds a seat (see teamController).
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

-- Enums --------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_role') THEN
        CREATE TYPE team_role AS ENUM ('viewer', 'manager', 'admin');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_member_status') THEN
        CREATE TYPE team_member_status AS ENUM ('pending', 'active', 'removed');
    END IF;
END$$;

-- Table: team_members ------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
    team_member_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_owner_user_id UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    invited_user_id       UUID REFERENCES users (user_id) ON DELETE SET NULL,
    email                 VARCHAR(255) NOT NULL,
    role                  team_role NOT NULL DEFAULT 'viewer',
    status                team_member_status NOT NULL DEFAULT 'pending',
    invited_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One membership record per email per owner (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_owner_email
    ON team_members (account_owner_user_id, lower(email));

-- A linked user can only belong to a given owner once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_owner_user
    ON team_members (account_owner_user_id, invited_user_id)
    WHERE invited_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_invited_user
    ON team_members (invited_user_id) WHERE invited_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_owner
    ON team_members (account_owner_user_id);

DROP TRIGGER IF EXISTS trg_team_members_updated_at ON team_members;
CREATE TRIGGER trg_team_members_updated_at
    BEFORE UPDATE ON team_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Table: team_invitations --------------------------------------------------
CREATE TABLE IF NOT EXISTS team_invitations (
    invitation_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_owner_user_id UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    invited_email         VARCHAR(255) NOT NULL,
    role                  team_role NOT NULL DEFAULT 'viewer',
    token                 TEXT NOT NULL UNIQUE,
    expires_at            TIMESTAMPTZ NOT NULL,
    accepted_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_email
    ON team_invitations (lower(invited_email));

CREATE INDEX IF NOT EXISTS idx_team_invitations_owner
    ON team_invitations (account_owner_user_id);

DROP TRIGGER IF EXISTS trg_team_invitations_updated_at ON team_invitations;
CREATE TRIGGER trg_team_invitations_updated_at
    BEFORE UPDATE ON team_invitations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
