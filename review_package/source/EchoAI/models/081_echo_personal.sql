-- ============================================================================
-- 081_echo_personal.sql — Echo Personal Assistant: reminders + tasks
--
-- Personal reminders ("remind me to call Robert at 2pm tomorrow") delivered by
-- voice while the owner is logged in, with an SMS fallback when the spoken
-- reminder isn't picked up within a few minutes. Tasks are time-less to-dos
-- with priority levels (high = flagged immediately, medium = daily briefing,
-- low = weekly briefing), created by voice, dashboard, or automatically from
-- business signals (e.g. a hot lead waiting 24 hours).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- --- Personal reminders ------------------------------------------------------
--   recurrence : none | daily | weekly | monthly. When a recurring reminder is
--                delivered, the same row is rescheduled to the next occurrence.
--   status     : scheduled  → waiting for due_at
--                notifying  → voice notification enqueued; SMS fallback pending
--                delivered  → spoken (or texted); terminal for non-recurring
--                completed  → owner marked it done in the dashboard
--                cancelled  → owner deleted/dismissed it
--   delivery_channel : how it actually reached the owner (voice | sms), set at
--                delivery time; NULL until then.
CREATE TABLE IF NOT EXISTS echo_reminders (
    reminder_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    reminder_text     TEXT NOT NULL,
    due_at            TIMESTAMPTZ NOT NULL,
    recurrence        VARCHAR(20) NOT NULL DEFAULT 'none',
    status            VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    delivery_channel  VARCHAR(10),
    source            VARCHAR(20) NOT NULL DEFAULT 'voice',
    voice_notification_id UUID,
    voice_enqueued_at TIMESTAMPTZ,
    delivered_at      TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_echo_reminders_due
    ON echo_reminders (status, due_at);
CREATE INDEX IF NOT EXISTS idx_echo_reminders_user
    ON echo_reminders (user_id, status, due_at);

-- --- Personal tasks -----------------------------------------------------------
--   priority : high | medium | low  (high = flagged immediately + overdue SMS,
--              medium = daily briefing, low = weekly briefing)
--   status   : open | completed
--   source   : voice | dashboard | auto (auto = Echo created it from a business
--              signal such as a hot lead waiting 24 hours)
--   auto_ref : idempotency key for auto-created tasks (e.g. 'hotlead:<lead_id>')
--              so a sweep can never create the same auto-task twice.
--   last_check_in_at : the last time Echo asked about this task ("has that been
--              taken care of?") so stale-task check-ins don't nag every day.
--   sms_alerted_at   : when the overdue-high-priority SMS alert went out (once).
CREATE TABLE IF NOT EXISTS echo_tasks (
    task_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    task_text         TEXT NOT NULL,
    priority          VARCHAR(10) NOT NULL DEFAULT 'medium',
    due_date          DATE,
    status            VARCHAR(20) NOT NULL DEFAULT 'open',
    source            VARCHAR(20) NOT NULL DEFAULT 'voice',
    auto_ref          VARCHAR(160),
    last_check_in_at  TIMESTAMPTZ,
    sms_alerted_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_echo_tasks_user
    ON echo_tasks (user_id, status, priority);

-- One auto-task per signal per owner (ON CONFLICT backstop for the sweep).
CREATE UNIQUE INDEX IF NOT EXISTS idx_echo_tasks_auto_ref
    ON echo_tasks (user_id, auto_ref)
    WHERE auto_ref IS NOT NULL;
