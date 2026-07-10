-- Two-Way Autonomous Conversation system.
--
-- When a lead REPLIES to any outbound message (SMS, email, or the website
-- chatbot), Echo handles the back-and-forth autonomously. This table is the
-- state machine for one such conversation: it tracks the channel, the running
-- transcript, the live intent, whether the owner has been alerted about a hot
-- buying signal, and how/why the conversation ended.
--
-- Terminal conditions (close_reason): the lead booked an appointment, converted
-- to a customer, explicitly said stop / not-interested, went 48h without
-- replying (timed_out), or the owner took over (transferred).

CREATE TABLE IF NOT EXISTS autonomous_conversations (
  conversation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  lead_id              UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  channel              VARCHAR(16) NOT NULL
                         CHECK (channel IN ('sms', 'email', 'chatbot')),
  status               VARCHAR(24) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'awaiting_owner', 'transferred', 'closed')),
  close_reason         VARCHAR(24)
                         CHECK (close_reason IN ('booked', 'converted', 'stopped', 'timed_out', 'transferred')),
  last_intent          VARCHAR(60),
  buying_signal        BOOLEAN NOT NULL DEFAULT FALSE,
  owner_alerted_at     TIMESTAMPTZ,
  handoff_requested_at TIMESTAMPTZ,
  handoff_by           UUID REFERENCES users(user_id) ON DELETE SET NULL,
  message_count        INTEGER NOT NULL DEFAULT 0,
  transcript           JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_inbound_at      TIMESTAMPTZ,
  last_outbound_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one OPEN conversation per lead per channel. A partial unique index
-- (open statuses only) lets a lead start a fresh conversation after a prior one
-- on the same channel has closed, while blocking duplicate concurrent threads.
CREATE UNIQUE INDEX IF NOT EXISTS uq_autoconv_open_per_lead_channel
  ON autonomous_conversations (brand_id, lead_id, channel)
  WHERE status IN ('active', 'awaiting_owner');

CREATE INDEX IF NOT EXISTS idx_autoconv_brand_status
  ON autonomous_conversations (brand_id, status);

-- Drives the 48h-silence timeout sweep: find open conversations whose last
-- inbound is older than the cutoff.
CREATE INDEX IF NOT EXISTS idx_autoconv_timeout
  ON autonomous_conversations (status, last_inbound_at)
  WHERE status IN ('active', 'awaiting_owner');
