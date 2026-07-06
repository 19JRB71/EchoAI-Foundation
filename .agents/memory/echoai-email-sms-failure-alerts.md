---
name: EchoAI email/SMS failure alerts
description: How failed-send owner alerts work for drip emails and SMS blasts (shared helper, transition-gated, aggregated).
---

All failed-send owner alerts go through one shared helper (`utils/failedSendAlerts.js` → `alertOwnerOfFailedSend`): brand lookup, demo/ownerless skip, best-effort web push + FCM mirror, never throws. Social, email, and SMS alert paths all delegate to it — add new failure alerts there, don't hand-roll push calls.

**Rules:**
- Alert only on a real state transition to 'failed', proven by the row count of a status-guarded UPDATE (`... AND delivery_status='pending'` / `AND status='sending'` RETURNING). A lost race = someone else owns the transition (and its alert).
- Drip emails retry per-recipient via a `send_attempts` counter (limit 3) committed inside the FOR UPDATE claim transaction; below the limit the row stays pending, no alert. At the limit the flip + alert happen. Alerts are **aggregated one per campaign per run** (tag `email-campaign-failed-<id>`), never per recipient.
- **Cross-run cooldown:** per-run aggregation alone still buzzes hourly during a multi-hour SMTP outage (new recipients exhaust attempts each run; FCM doesn't collapse by tag). Drip alerts additionally claim a 24h per-campaign cooldown via an atomic UPDATE on `email_marketing_campaigns.last_failure_alert_at` (branch on row count) before alerting — only the winning run alerts; the failed flips still happen regardless. Claim DB errors skip the alert (fail toward silence, next run retries).
- SMS blast: request-path `sendCampaign` alerts only when its own guarded final flip lands with `failed`; the health monitor's stale-'sending' rescue alerts separately for each campaign its RETURNING rows rescued. The two paths can't double-alert because only one wins the guarded flip.
- Deep links use real client section ids: `?section=email`, `?section=sms`.

**Why:** mirrors the social-post alert invariants (transition-gated, demo-skip, per-item tag dedup); per-recipient email alerts would spam an owner once per contact on an SMTP outage.

**How to apply:** any new background sender that can flip something to 'failed' should reuse the helper, gate on the atomic flip's row count, and aggregate to one alert per user-meaningful unit.
