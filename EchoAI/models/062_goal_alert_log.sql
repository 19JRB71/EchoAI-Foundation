-- Channel-agnostic dedup/claim log for daily goal alerts.
--
-- The daily sweep can raise more than one alert per goal per day (a status
-- alert AND a momentum swing), and it fans each alert out across multiple
-- channels (Echo voice, web push, mobile push). To make the whole fan-out
-- idempotent — so overlapping/re-run ticks never double-send push — each
-- (goal, kind, day) is CLAIMED here atomically before dispatch. Only the tick
-- that wins the claim dispatches; later ticks see the row and skip entirely.
--
-- This is deliberately independent of the per-user voice dedup key so that
-- push/mobile delivery is not coupled to a user's voice-notification settings.

CREATE TABLE IF NOT EXISTS goal_alert_log (
  goal_id     UUID NOT NULL REFERENCES brand_goals(goal_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  alert_date  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (goal_id, kind, alert_date)
);
