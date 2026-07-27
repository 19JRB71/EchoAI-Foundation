-- Per-campaign cooldown for drip-failure owner alerts.
--
-- Drip failure alerts already aggregate to one alert per campaign per run,
-- but during a multi-hour SMTP outage different recipients of the same
-- campaign exhaust their attempts in different hourly runs — producing one
-- alert per run. The web-push tag collapses duplicates in the tray, but FCM
-- mobile pushes don't collapse by tag at all, so the owner's phone buzzed
-- once an hour for the same broken campaign.
--
-- sendDueDripEmails now claims this timestamp atomically (UPDATE ... WHERE
-- last_failure_alert_at IS NULL OR older than the cooldown, branch on row
-- count) before alerting, so a campaign alerts at most once per cooldown
-- window no matter how many hourly runs see new failures.

ALTER TABLE email_marketing_campaigns
  ADD COLUMN IF NOT EXISTS last_failure_alert_at TIMESTAMPTZ;
