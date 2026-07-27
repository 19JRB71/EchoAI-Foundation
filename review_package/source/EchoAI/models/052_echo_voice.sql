-- ============================================================================
-- 052_echo_voice.sql — Echo Voice Reminders & Daily Briefing (Prompt 58)
--
-- Gives Echo a real spoken voice: a per-owner voice-settings blob, the profile
-- fields the spoken copy needs (first name, last-login for "since you were last
-- here", last-briefing for once-per-day), and a durable queue of spoken events
-- (reminders + real-time alerts) the client drains while the owner is logged in.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- --- User profile additions -------------------------------------------------
-- first_name    : the owner's name used in every spoken line ("Good morning James").
-- last_login_at : set on each login so the morning briefing can summarize
--                 "everything since you were last here".
-- last_briefing_at : when the morning briefing was last spoken — used to play it
--                 only once per day, not on every page refresh.
-- voice_settings: JSONB of the owner's voice preferences (enabled, style,
--                 volume, quiet hours, per-event toggles, auto-briefing). App
--                 code fills defaults; NULL means "never configured → defaults".
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_briefing_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_settings JSONB;

-- --- Spoken-event queue -----------------------------------------------------
-- Time-driven reminders (appointment 15m/5m, follow-up due, closing summary) and
-- real-time alerts (hot lead, low budget, Sentinel fix, rep completed) are
-- enqueued here. The client polls for pending rows, speaks them via TTS, then
-- marks them delivered. Deterministic template copy is stored in spoken_text so
-- delivery never depends on AI uptime.
--
--   event_type : appointment_15m | appointment_5m | followup_due | day_summary
--                | hot_lead | budget_low | sentinel_fixed | rep_completed
--   status     : pending | delivered | dismissed
--   dedup_key  : app-code idempotency (e.g. "appt15:<appointmentId>") so an
--                overlapping scheduler tick can't enqueue the same reminder twice.
--   deliver_after / expires_at : only surface between these times (a 15-min
--                reminder that's now 20 min stale should not fire late).
CREATE TABLE IF NOT EXISTS echo_voice_notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    brand_id        UUID REFERENCES brands (brand_id) ON DELETE CASCADE,
    event_type      VARCHAR(40) NOT NULL,
    title           VARCHAR(255),
    spoken_text     TEXT NOT NULL,
    payload         JSONB,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    dedup_key       VARCHAR(255),
    deliver_after   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_echo_voice_notifications_pending
    ON echo_voice_notifications (user_id, status, deliver_after);

-- One row per (owner, dedup_key): the ON CONFLICT backstop for enqueue so
-- concurrent scheduler ticks can't double-enqueue the same reminder/alert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_echo_voice_notifications_dedup
    ON echo_voice_notifications (user_id, dedup_key)
    WHERE dedup_key IS NOT NULL;
