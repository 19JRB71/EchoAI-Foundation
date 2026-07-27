-- Proactive channel/tool suggestions surfaced in Echo's weekly briefing.
--
-- Echo looks at gaps in the owner's OWN account (channels/tools they haven't set
-- up yet) and suggests the highest-leverage next one. This table dedupes those
-- nudges so Echo never nags: a suggestion that was shown recently is suppressed
-- for 30 days, and one the owner declined is suppressed for 90 days. Once
-- accepted, it is never suggested again.
--
-- One row per (user, suggestion_key); the key is a stable channel/tool id
-- (e.g. "email", "sms", "chatbot"). status is the latest decision.
CREATE TABLE IF NOT EXISTS echo_suggestions (
    suggestion_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    suggestion_key TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'shown', -- shown | accepted | declined
    shown_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, suggestion_key)
);

CREATE INDEX IF NOT EXISTS idx_echo_suggestions_user
    ON echo_suggestions (user_id);
