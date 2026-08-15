-- Prompt 035 Stage 2 (Section L / O item 2): honest onboarding timing
-- instrumentation. APPEND-ONLY: rows are only ever inserted; no code path
-- updates or deletes them, and no elapsed time is ever truncated or erased.
--
-- event_kind vocabulary (validated in utils/onboardingTiming.js):
--   surface_shown | surface_hidden | focus | blur | activity | heartbeat |
--   system_wait_start | system_wait_end | milestone
--
-- ADDITIVE ONLY.

CREATE TABLE IF NOT EXISTS onboarding_timing_events (
  event_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  brand_id   UUID REFERENCES brands(brand_id) ON DELETE SET NULL,
  phase      TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta       JSONB
);

CREATE INDEX IF NOT EXISTS idx_onboarding_timing_events_user_at
  ON onboarding_timing_events (user_id, at);
