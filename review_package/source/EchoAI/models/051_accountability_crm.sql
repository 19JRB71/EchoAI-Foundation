-- 051: Employee Accountability CRM — tables & columns.
--
-- Depends on the enum values added in 050 (now committed and usable). Adds:
--   * a phone number on team members / invitations (for phone-bridge calling),
--   * lead-queue assignment columns on leads,
--   * recording + agent-attribution columns on calls.
-- All statements are idempotent (IF NOT EXISTS) per the migration convention.

-- --------------------------------------------------------------------------
-- Team member phone (captured at invite) — used to ring the rep's own phone
-- for the phone bridge. The rep never sees the lead's number.
-- --------------------------------------------------------------------------
ALTER TABLE team_members    ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

-- --------------------------------------------------------------------------
-- Lead queue — one-lead-at-a-time assignment to a sales rep.
--   queue_state: 'unassigned' | 'assigned' | 'completed' | 'removed'
--   queue_priority: optional manual bump (lower = sooner); NULLS use arrival.
-- --------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_rep_user_id UUID
  REFERENCES users (user_id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS queue_state VARCHAR(20) NOT NULL DEFAULT 'unassigned';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS queue_priority INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS worked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_rep ON leads (assigned_rep_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_queue_state ON leads (queue_state);

-- --------------------------------------------------------------------------
-- Calls — attribute every call to the human agent who made it and store the
-- recording so owners/admins can review it for accountability.
-- --------------------------------------------------------------------------
ALTER TABLE calls ADD COLUMN IF NOT EXISTS agent_user_id UUID
  REFERENCES users (user_id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS agent_name VARCHAR(255);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_sid VARCHAR(64);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_duration INTEGER;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_agent_user ON calls (agent_user_id);
