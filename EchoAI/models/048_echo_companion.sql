-- 048_echo_companion.sql
-- Echo persistent AI companion: one row per user tracks the post-setup activation
-- journey (connect Facebook -> preview+approve campaign -> activate calendar ->
-- ongoing mode) plus the companion chat log and any action awaiting approval.
-- Idempotent (IF NOT EXISTS) like every other migration.

CREATE TABLE IF NOT EXISTS echo_companion (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
    -- pending  : setup done, activation not started yet
    -- in_progress: walking the user through activation steps
    -- active   : activation complete, Echo is in ongoing management mode
    activation_status  TEXT NOT NULL DEFAULT 'pending',
    -- activation step keys already handled (done/skipped)
    completed_actions  JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- the single action currently previewed and awaiting Approve/Decline (or null)
    pending_action     JSONB,
    -- the companion chat log: [{ id, role, type, text, card?, ts }]
    messages           JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_echo_companion_user_id ON echo_companion (user_id);
