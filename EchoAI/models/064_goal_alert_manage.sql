-- Owner-facing management of daily goal alerts.
--
-- goal_alert_log started as a pure dedup/claim log (062). Owners now review the
-- logged alerts in a dashboard feed, so each row gains:
--   - alert_id         a stable per-row id the client can dismiss by
--   - percent_to_goal  the percent-to-goal captured at alert time (feed detail)
--   - dismissed_at     set when the owner dismisses the alert from the feed
-- The composite (goal_id, kind, alert_date) PK stays the claim key — dismissing
-- never deletes the row, so the claim still dedups re-run ticks.
--
-- brand_goals gains alerts_muted: when true the daily sweep still snapshots the
-- goal (history/trend keeps accruing) but raises no alerts for it on any
-- channel (voice, web push, mobile push, feed).

ALTER TABLE goal_alert_log
  ADD COLUMN IF NOT EXISTS alert_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS goal_alert_log_alert_id_key
  ON goal_alert_log (alert_id);

ALTER TABLE goal_alert_log
  ADD COLUMN IF NOT EXISTS percent_to_goal NUMERIC;

ALTER TABLE goal_alert_log
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

ALTER TABLE brand_goals
  ADD COLUMN IF NOT EXISTS alerts_muted BOOLEAN NOT NULL DEFAULT false;
