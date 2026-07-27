-- 041_setup_agent.sql
-- AI Setup Agent: a conversational onboarding agent that interviews a new user
-- and configures their account server-side by orchestrating existing controllers.
--
-- One row per setup run. Stores the interview transcript + collected answers, the
-- ordered list of setup actions already completed (for idempotent re-runs), and an
-- explicit, auto-expiring consent flag that must be granted before any action runs.
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS setup_sessions (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  -- in_progress | paused | completed | dismissed
  status             TEXT NOT NULL DEFAULT 'in_progress',
  -- collected interview answers, keyed by the field the AI chose to collect
  answers            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- full interview transcript ({ role, content }) that drives the adaptive AI
  messages           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- keys of setup actions already run (done or skipped) so re-runs skip them
  completed_steps    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- the answer field the most recent question is collecting (null once complete)
  current_field      TEXT,
  -- true once the AI signals the interview has gathered enough to configure
  interview_complete BOOLEAN NOT NULL DEFAULT FALSE,
  -- explicit in-app consent to let EchoAI perform setup actions; auto-revoked on completion
  consent_granted    BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at         TIMESTAMPTZ,
  -- the brand created/configured during this setup run
  brand_id           UUID REFERENCES brands (brand_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_setup_sessions_user ON setup_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_setup_sessions_user_status ON setup_sessions (user_id, status);
