-- Migration 047: AI Sales Agent with Three-Way Call Support
--
-- sales_calls: one row per inbound demo call to EchoAI's OWN dedicated sales
-- line (Echo, the AI Sales Agent). This is platform-level — EchoAI selling
-- itself — so it is NOT brand-scoped like the per-brand phone agent's `calls`
-- table. Stores the full spoken transcript, the running 1-10 interest score,
-- the AI-generated end-of-call summary, and the booked/follow-up flags.
--
-- sales_agent_config: a SINGLETON row (enforced by a unique constant key) that
-- the platform owner edits in the admin panel — owner phone for three-way
-- invites, whether "Hey Echo" replies are spoken or texted, the demo booking
-- link, the top-5 objections + preferred responses, and the enable toggle.
-- The dedicated sales Twilio credentials live in env vars (SALES_TWILIO_*),
-- not here, so no secrets are stored in this table.

CREATE TABLE IF NOT EXISTS sales_calls (
  call_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_call_sid       VARCHAR(64) UNIQUE,
  prospect_phone        VARCHAR(32),
  prospect_name         VARCHAR(255),
  business_type         VARCHAR(255),
  conversation_history  JSONB NOT NULL DEFAULT '[]'::jsonb,
  interest_score        INTEGER NOT NULL DEFAULT 0,
  outcome               VARCHAR(32),
  call_duration         INTEGER NOT NULL DEFAULT 0,
  summary               TEXT,
  booked_demo           BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_scheduled   BOOLEAN NOT NULL DEFAULT FALSE,
  invite_sent           BOOLEAN NOT NULL DEFAULT FALSE,
  status                VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_calls_status ON sales_calls (status);
CREATE INDEX IF NOT EXISTS idx_sales_calls_created_at ON sales_calls (created_at DESC);

DROP TRIGGER IF EXISTS trg_sales_calls_updated_at ON sales_calls;
CREATE TRIGGER trg_sales_calls_updated_at BEFORE UPDATE ON sales_calls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sales_agent_config (
  config_key       VARCHAR(20) PRIMARY KEY DEFAULT 'singleton',
  owner_phone      VARCHAR(32),
  hey_echo_mode    VARCHAR(10) NOT NULL DEFAULT 'sms',   -- 'voice' | 'sms'
  booking_link     TEXT,
  objections       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{objection, response}]
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_agent_config_singleton CHECK (config_key = 'singleton')
);

DROP TRIGGER IF EXISTS trg_sales_agent_config_updated_at ON sales_agent_config;
CREATE TRIGGER trg_sales_agent_config_updated_at BEFORE UPDATE ON sales_agent_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the singleton config row so the admin panel always has a row to edit.
INSERT INTO sales_agent_config (config_key)
VALUES ('singleton')
ON CONFLICT (config_key) DO NOTHING;
