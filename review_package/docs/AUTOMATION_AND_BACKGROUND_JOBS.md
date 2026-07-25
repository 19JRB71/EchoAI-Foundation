# Automation and Background-Job Inventory

**Scope:** Every scheduled task, cron job, queue, worker, event trigger, webhook, retry process, and background AI job in the Zorecho / EchoAI **server** (`EchoAI/`).
**Method:** Verified against the CURRENT code — primarily `EchoAI/utils/scheduler.js` (the single cron registrar), `EchoAI/server.js` (boot sequence), and the controller/util each job calls. Cross-checked with `grep` for `setInterval|setTimeout|cron`.
**Date of review:** 2026-07-24. **Environment context:** dev = Replit workspace; staging = staging.zorecho.com; prod = app.zorecho.com.

> Truthfulness note: A registered cron job is NOT proof the external work happens. Where a job calls an external service (Facebook, Twilio, SMTP, FCM, etc.), the actual external effect is classified in `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`. Here we document trigger, intended behavior, actual code behavior, retry, silent-failure risk, and whether the job is active.

---

## 1. How scheduling works (architecture)

- **Single scheduler:** `EchoAI/utils/scheduler.js`. It uses **`node-cron`** (`const cron = require("node-cron")`, line 1). There is **one** `startScheduler()` function that registers every recurring job via a `scheduleJob({ name, cronExpr, run, ai, control })` helper (line 745).
- **Boot:** `EchoAI/server.js` imports `{ startScheduler }` (line 95) and calls `startScheduler()` (line 462) after the server is up. This means **all crons run inside the single web/server process** — there is **no separate worker dyno/queue service**. If the process is not running (or Railway scales it to zero), **no background job fires**.
- **Where it runs:** In whatever process serves the app. On Railway prod/staging this is the one service; in dev it is the Replit workspace process. Jobs do **NOT** depend on any end-user keeping a browser open (they are server-side crons) — **except** browser Web Push delivery targets, which only matter at delivery time, not for the job firing.
- **AI cost gating:** Each job registered with `ai: true` is wrapped by `executeJob()` (line 713). Before running, it checks `backgroundAiAllowedHere()` (env/emergency-shutoff/`BACKGROUND_AI_ENABLED`) and an optional per-job `control` switch (from `config/aiControls.js`). If not allowed, the job **skips** (logged once per reason change via `lastSkipReason`, lines 709–735) and records `lastSkippedAt`/`lastSkipReason`. Non-AI (`ai: false`) jobs — publishing, reminders, sweeps, verification — **always run** so scheduled work is never silently dropped.
- **Workflow attribution:** Every tick runs inside `runWithWorkflow({ triggeredBy: "background", jobName }, run)` (line 741) so any paid AI/comms calls roll up in the usage ledger under that job.
- **Skip gates (cost de-dup):** Many AI jobs wrap per-brand work in `gateJob(type, brandId)` (`utils/skipGates.js`) which hashes the inputs and **skips the expensive recompute when nothing changed** (`gate.run` / `gate.skip()` / `gate.done()`). The owner-facing output (e.g. weekly email) is still delivered from the last stored snapshot (`latestStoredAnalytics`, line 132).
- **Concurrency safety:** Sage sweeps claim each brand atomically per run bucket via `claimRun/finishRun` (from `sageController`) so overlapping ticks / restarts don't double-run. An optional **job queue** path (`utils/jobQueue.js`, `runSageSweepViaQueue`, line 99) is behind the `SAGE_V2_JOB_QUEUE` flag (**default OFF**) and, when on, enqueues one row per brand and drains with `FOR UPDATE SKIP LOCKED`, plus `rescueStaleClaims()`.
- **Registry/observability:** `JOBS[]` (line 707) holds every registered job; `listScheduledJobs()` (line 754) exposes it (used by the admin status endpoint / Sentinel dashboard). Startup logs a summary of how many AI vs operational jobs registered (lines 1156–1164).

### Launch-cadence caveat (IMPORTANT — several AI jobs are OFF by default)
The startup log and job configs make clear that during the "launch sprint" the heaviest AI jobs are **switched off** unless re-enabled via the AI controls:
- `WEEKLY_AI_STACK_ENABLED` gates: `weekly-analytics`, `cross-business-intelligence`, `weekly-learning-study`, `weekly-self-review`, `weekly-autopilot`, `sage-opportunity-synthesis`. **Default off.**
- `SAGE_URGENT_ENABLED` gates `sage-urgent-scan` (every 30 min) — explicitly called out as "the single biggest credit burner"; **default off.**
- `AUTONOMOUS_GROWTH_ENABLED` gates `autonomous-growth` + `autonomous-growth-summary`. **Default off.**
- `COMPETITOR_RESEARCH_ENABLED` / `SAGE_RESEARCH_ENABLED` gate competitor + Sage research jobs.
- Several Sage V2 jobs are additionally behind feature flags (`SAGE_V2_OPPORTUNITIES`, `SAGE_V2_DIRECTIVES`, `SAGE_V2_TRUTH_INPUTS`, `SAGE_V2_DQ_SENTRY`, `SAGE_V2_SELF_EVAL`, `COLLAB_BUS`) which **no-op** when dark.

The exact live on/off state depends on the values stored in `config/aiControls.js` switches at review time — **UNVERIFIED per environment** from static code alone; defaults as coded are noted above.

---

## 2. Complete cron job table

All cron expressions and behaviors are read directly from `EchoAI/utils/scheduler.js`. "AI-gated" = registered `ai: true` (subject to background-AI + control switch). "Control" is the per-job switch (blank = none). Times are UTC (node-cron on server clock).

| # | Job name | Cron (`cronExpr`) | Cadence | AI-gated | Control switch | Runner (function → module) | Active by default? |
|---|----------|-------------------|---------|----------|----------------|----------------------------|--------------------|
| 1 | `weekly-analytics` | `0 8 * * 1` | Mon 08:00 | Yes | `WEEKLY_AI_STACK_ENABLED` | `runWeeklyAnalytics` (scheduler) | **OFF** (control default off) |
| 2 | `social-publish` | `* * * * *` | Every minute | No | — | `publishDuePosts` → `socialController` | **ON** |
| 3 | `follow-up-touchpoints` | `*/5 * * * *` | Every 5 min | No | — | `executeDueTouchpoints` → `followUpController` | **ON** |
| 4 | `drip-emails` | `0 * * * *` | Hourly | No | — | `sendDueDripEmails` → `emailMarketingController` | **ON** |
| 5 | `email-blasts` | `*/5 * * * *` | Every 5 min | No | — | `sendDueScheduledCampaigns` → `emailMarketingController` | **ON** |
| 6 | `health-monitor-sweep` | `0 * * * *` | Hourly | No* | — | `runHourlyHealthSweep` → `healthMonitorController` | **ON** (AI analysis gated at provider) |
| 7 | `api-quota-sweep` | `0 * * * *` | Hourly | No | — | `runApiQuotaSweep({notify:true})` → `utils/apiQuotaMonitor` | **ON** |
| 8 | `objections-mining` | `30 4 1 * *` | Monthly (1st 04:30) | Yes | — (flag `SAGE_V2_TRUTH_INPUTS` inside) | `runMonthlyObjectionsMining` → `utils/objectionsMining` | ON if bg-AI on; no-op while flag dark |
| 9 | `data-quality-sentry` | `30 3 * * *` | Daily 03:30 | No | — (flag `SAGE_V2_DQ_SENTRY` inside) | `runNightlySentry` → `utils/dataQualitySentry` | ON; no-op while flag dark |
| 10 | `autonomous-timeout-sweep` | `*/15 * * * *` | Every 15 min | No | — | `runAutonomousTimeoutSweep` → `autonomousConversationController` | **ON** |
| 11 | `email-inbox-sweep` | `*/15 * * * *` | Every 15 min | Yes | — | `sweepAllEmailAccounts` → `utils/emailMonitor` | ON if bg-AI on |
| 12 | `voice-reminders` | `* * * * *` | Every minute | No | — | `sweepDueReminders` → `utils/echoVoiceReminders` | **ON** |
| 13 | `personal-reminders` | `* * * * *` | Every minute | No | — | `sweepPersonalReminders` → `utils/echoPersonal` | **ON** |
| 14 | `daily-task-sweep` | `0 9 * * *` | Daily 09:00 | No | — | `runDailyTaskSweep` → `utils/echoPersonal` | **ON** |
| 15 | `closing-summaries` | `0 18 * * *` | Daily 18:00 | Yes | — | `enqueueClosingSummaries` → `utils/echoVoiceReminders` | ON if bg-AI on |
| 16 | `autonomous-growth` | `0 7 * * *` | Daily 07:00 | Yes | `AUTONOMOUS_GROWTH_ENABLED` | `runDailyAutonomousGrowth` → `autonomousGrowthController` | **OFF** |
| 17 | `autonomous-growth-summary` | `0 20 * * *` | Daily 20:00 | Yes | `AUTONOMOUS_GROWTH_ENABLED` | `sendDailyAutonomousSummary` → `autonomousGrowthController` | **OFF** |
| 18 | `portfolio-health-snapshots` | `0 6 * * *` | Daily 06:00 | No | — | `runDailyHealthSnapshots` → `snapshotHealth` (`utils/portfolio`) | **ON** |
| 19 | `morning-briefing-warm` | `0 6 * * *` | Daily 06:00 | Yes | — | `warmMorningBriefings` → `echoVoiceController` | ON if bg-AI on (else on-demand at login) |
| 20 | `goal-tracking` | `45 5 * * *` | Daily 05:45 | No | — | `runDailyGoalTracking` → `utils/goalAlerts` | **ON** |
| 21 | `beta-program-sweep` | `30 9 * * *` | Daily 09:30 | No | — | `runBetaProgramSweep` → `utils/betaProgram` | **ON** |
| 22 | `cross-business-intelligence` | `15 8 * * 1` | Mon 08:15 | Yes | `WEEKLY_AI_STACK_ENABLED` | `runWeeklyCrossBusinessIntelligence` (scheduler) | **OFF** |
| 23 | `weekly-learning-study` | `0 5 * * 1` | Mon 05:00 | Yes | `WEEKLY_AI_STACK_ENABLED` | `runWeeklyLearningStudy` → `utils/learningEngine` | **OFF** |
| 24 | `weekly-self-review` | `15 7 * * 1` | Mon 07:15 | Yes | `WEEKLY_AI_STACK_ENABLED` | `runWeeklySelfReview` → `utils/selfReview` | **OFF** |
| 25 | `weekly-autopilot` | `30 6 * * 1` | Mon 06:30 | Yes | `WEEKLY_AI_STACK_ENABLED` | `runWeeklyAutopilot` → `autopilotController` | **OFF** |
| 26 | `sage-opportunity-synthesis` | `30 5 * * 1` | Mon 05:30 | Yes | `WEEKLY_AI_STACK_ENABLED` | `runSageOpportunitySynthesis` (scheduler; flag `SAGE_V2_OPPORTUNITIES` inside) | **OFF** |
| 27 | `sage-opportunity-maintenance` | `20 2 * * *` | Daily 02:20 | No | — (flags inside) | `runSageOpportunityMaintenance` (scheduler) | **ON**; sub-steps no-op while flags dark |
| 28 | `competitor-scan` | `0 5 * * *` | Daily 05:00 | Yes | `COMPETITOR_RESEARCH_ENABLED` | `runCompetitorScan` (scheduler) | Gated by control |
| 29 | `competitor-ad-scan` | `45 5 * * *` | Daily 05:45 | Yes | `COMPETITOR_RESEARCH_ENABLED` | `runCompetitorAdScan` (scheduler) | Gated by control |
| 30 | `competitor-site-monitor` | `0 4 * * *` | Daily 04:00 | Yes | `COMPETITOR_RESEARCH_ENABLED` | `runCompetitorSiteMonitor` (scheduler) | Gated by control |
| 31 | `vision-daily-study` | `30 4 * * *` | Daily 04:30 | Yes | — | `runDailyVisionStudy` → `utils/visionEngine` | ON if bg-AI on |
| 32 | `competitor-site-digest` | `30 8 * * 1` | Mon 08:30 | No | — | `runCompetitorSiteDigest` (scheduler) | **ON** (Enterprise gate inside) |
| 33 | `social-connection-reverify` | `30 */6 * * *` | Every 6h at :30 | No | — | `reverifySocialConnections` → `socialController` | **ON** |
| 34 | `sage-deep-research` | `15 6 * * *` | Daily 06:15 | Yes | `SAGE_RESEARCH_ENABLED` | `runSageDeepCycle` (scheduler) | Gated by control |
| 35 | `sage-urgent-scan` | `*/30 * * * *` | Every 30 min | Yes | `SAGE_URGENT_ENABLED` | `runSageUrgentScan` (scheduler) | **OFF** (biggest credit burner) |
| 36 | `sage-pattern-study` | `45 5 * * 2` | Tue 05:45 | Yes | `SAGE_RESEARCH_ENABLED` | `runSagePatternStudy` (scheduler) | Gated by control |
| 37 | `re-listing-promotion` | `20 * * * *` | Hourly at :20 | Yes | — | `runListingPromotionSweep` → `utils/realEstateAutomation` | ON if bg-AI on (real_estate brands) |
| 38 | `re-seller-lead-ads` | `30 7 * * *` | Daily 07:30 | Yes | — | `runSellerLeadAdSweep` → `utils/realEstateAutomation` | ON if bg-AI on |
| 39 | `re-open-house` | `30 7 * * *` | Daily 07:30 | No | — | `runOpenHouseSweep` → `utils/realEstateAutomation` | **ON** (reminders keep running even if AI paused) |
| 40 | `re-content-morning` | `0 9 * * *` | Daily 09:00 | Yes | — | `runRealEstateContentRun(0)` → `utils/realEstateAutomation` | ON if bg-AI on |
| 41 | `re-content-midday` | `0 13 * * *` | Daily 13:00 | Yes | — | `runRealEstateContentRun(1)` | ON if bg-AI on |
| 42 | `re-content-evening` | `0 17 * * *` | Daily 17:00 | Yes | — | `runRealEstateContentRun(2)` | ON if bg-AI on |

\* #6 `health-monitor-sweep` is registered `ai:false` **on purpose** (comment lines 793–796): detection is deterministic and must keep running; its conditional AI analysis is gated at the provider wrapper.

**Total registered:** 42 jobs (`JOBS.length`). The startup log computes `aiJobs = JOBS.filter(j => j.ai).length` and reports the split at boot.

---

## 3. Per-job detail (trigger / intended / actual / retry / silent-failure / active / tested)

For brevity, jobs are grouped. Every job follows the same "best-effort per brand, log & continue" error pattern unless noted — meaning **a single brand/owner failure is caught and logged to `console.error`, never stopping the rest of the sweep**. This is a deliberate design but also a **silent-failure risk**: failures are only visible in server logs, not surfaced to a dashboard for most jobs (Sage jobs additionally record run status via `finishRun(... "failed")`).

### 3.1 Operational delivery jobs (always run; no AI gate)

**`social-publish` (every minute) — `publishDuePosts` (`socialController.js`, line 866)**
- Trigger: cron every minute.
- Intended/actual: Flips due `scheduled_posts` from `scheduled` → `publishing` (SQL guard, only for posts under an `active` content calendar), then calls `socialApi.publishPost()` (real Facebook/Twitter/LinkedIn HTTP — see §External doc). On success sets `status='published'`, `external_post_id`. On failure sets `status='failed'`.
- Retry: A **10-minute stuck-`publishing` reclaim** exists — rows stuck in `publishing` older than 10 min are flipped to `failed` at the top of each run (lines 877–878). Transient errors (`429`/5xx) detected via `isRetryable` (line 825) can flip a post back to `scheduled` for a later retry (lines 940–943).
- Silent failure: Failed posts are marked `failed` in DB and surfaced in calendar UI; owners may also get failure alerts (`utils/socialFailureAlert` / `failedSendAlerts`). External publish success is **Real but untested end-to-end in prod** (see external doc).
- Active: **Yes.** Tested: server tests exist (`test/publishPostNow.test.js`, `test/socialMediaUpload.test.js`).

**`follow-up-touchpoints` (every 5 min) — `executeDueTouchpoints` (`followUpController.js`)**
- Sends due follow-up steps: **email** (`utils/email` SMTP), **SMS** and **phone calls** via Twilio (`buildClient(...).messages.create` / `.calls.create`, lines ~501/549). Real external sends when the brand has Twilio/SMTP configured.
- Retry: per-touchpoint; failures logged. Silent-failure risk if a brand's Twilio/SMTP creds are invalid — see external doc. Active: **Yes.**

**`drip-emails` (hourly) / `email-blasts` (every 5 min) — `emailMarketingController`**
- `sendDueDripEmails` / `sendDueScheduledCampaigns` send due drip-sequence emails and one-time scheduled blasts through `utils/email` (nodemailer/SMTP). On total blast failure the blast row flips to `failed` and the owner is alerted. Retry logic covered by `test/emailDripRetry.test.js`, `test/scheduledEmailBlast.test.js`, `test/emailSmsFailureAlert.test.js`. Active: **Yes.**

**`voice-reminders` / `personal-reminders` (every minute) — `echoVoiceReminders` / `echoPersonal`**
- Enqueue due Echo voice reminders (appointment 15m/5m, follow-up-call-due) and personal reminders (voice first, SMS fallback). Idempotent dedup keys make overlapping ticks safe. Delivery is via the voice notification queue + Twilio SMS fallback. Active: **Yes.** Tests: `test/echoVoiceReminders.test.js`.

**`autonomous-timeout-sweep` (every 15 min) — `autonomousConversationController.runAutonomousTimeoutSweep`**
- Closes any autonomous lead conversation whose lead has gone 48h without replying. Atomic + status-guarded (never double-acts). Active: **Yes.** (The conversation *replies* themselves use Twilio SMS — `buildClient(...).messages.create`, line 156.)

**`social-connection-reverify` (every 6h) — `reverifySocialConnections`**
- Re-verifies stored social tokens so an expired/revoked login is flagged `error` on calendars BEFORE the next scheduled post fails. Non-AI. Active: **Yes.**

**`health-monitor-sweep` / `api-quota-sweep` (hourly)**
- Health sweep: deterministic detection over active brands, auto-fixes safe issues, alerts owners on critical ones (conditional AI analysis gated at provider). API-quota sweep (`utils/apiQuotaMonitor`): checks third-party credit/quota (ElevenLabs, OpenAI, Anthropic, Twilio, Google Cloud) and alerts platform owner (voice+push) when any drops below threshold. Active: **Yes.**

**`goal-tracking` (05:45) / `portfolio-health-snapshots` (06:00) / `beta-program-sweep` (09:30) / `daily-task-sweep` (09:00)**
- Deterministic (no AI) snapshotting + alerting. `goal-tracking` writes goal snapshots + alerts (voice/push). `portfolio-health` computes 1–10 score per real brand. `beta-program-sweep` emails quiet testers + notifies waitlist. `daily-task-sweep` creates auto-tasks from hot leads, SMS alerts overdue tasks, 3-day stale check-ins. Active: **Yes.**

**`data-quality-sentry` (03:30) / `sage-opportunity-maintenance` (02:20)**
- Deterministic SQL maintenance, zero AI. Maintenance job also runs `directiveBus.runMeasurementJoin`, `opportunitySynthesis.runExpirySweep`, `sageSelfEval.refreshSelfEvalCaches`, and `collaborationBus.runBusMaintenance` — **each no-ops while its feature flag is dark** and each is independently try/caught. Active: **Yes** (sub-steps conditional).

### 3.2 AI-gated jobs (skip when background AI disallowed / control off)

- **`weekly-analytics` (Mon 08:00, `WEEKLY_AI_STACK_ENABLED`, default OFF):** The single biggest orchestrator (`runWeeklyAnalytics`, line 150). Per active brand it records weekly analytics (pulls Facebook insights), auto-optimizes campaigns, refreshes ad-creative performance, generates + **emails** the weekly report, fires an outbound **webhook** (`triggerWebhook`, "weekly_report_generated"), **mobile-pushes** via FCM, auto-sends a survey, builds feedback report, ROI snapshot, customer-intelligence, capital/funding scan, competitor-ad report, and Sage weekly briefing. Each sub-step is independently try/caught (silent-failure risk isolated per step). Skip gate reuses stored analytics when inputs unchanged so the email still goes out. Tests: many (`test/*`). Active: **OFF by default.**
- **`weekly-autopilot` (Mon 06:30, default OFF):** Drafts each enabled brand's week of posts+ads then alerts owner to review (approval-gated — does not auto-publish).
- **`weekly-learning-study` / `weekly-self-review` / `cross-business-intelligence` / `sage-opportunity-synthesis` (Mondays, default OFF):** AI synthesis/reporting only — recommendation/report writers, no external actions. Self-review is **recommendation-only, never changes any system** (comment lines 965–968).
- **`autonomous-growth` + summary (07:00 / 20:00, default OFF):** For owners who enabled it, adjusts budgets/pauses losers/reallocates within owner guardrails, then sends a plain-English recap. **This is the only job that can autonomously change live ad spend** — gated behind `AUTONOMOUS_GROWTH_ENABLED` AND per-owner opt-in AND `growthGuardrails`. Verify guardrail enforcement before enabling.
- **Competitor jobs (`competitor-scan`, `competitor-ad-scan`, `competitor-site-monitor`, `competitor-site-digest`):** Scout research. Ad-spy pulls confirmed competitors' live Facebook ads via Meta Ad Library — **no-ops entirely with no Facebook token (nothing fabricated)** (comment lines 355–357). Enterprise-tier gated inside controllers.
- **Sage research (`sage-deep-research` 06:15, `sage-urgent-scan` every 30 min OFF, `sage-pattern-study` Tue):** Live-web-search industry research; atomic per-brand claims; per-brand failures recorded via `finishRun(..."failed")`. `sage-urgent-scan` OFF by default.
- **`email-inbox-sweep` (every 15 min) — `utils/emailMonitor.sweepAllEmailAccounts`:** IMAP fetch on each connected mailbox, AI-triage, alert on urgent/contract/payment, capture leads into CRM. AI triage is core so it pauses when bg-AI off. Per-account guards.
- **`vision-daily-study` (04:30):** Vision distills competitor ad observations + brand image library into a visual knowledge base (AI). Honest sources only.
- **`morning-briefing-warm` (06:00):** Pre-generates owner morning briefings (AI); when bg-AI off it falls back to on-demand generation at login.
- **Real-estate jobs (#37–42):** For `real_estate` brands only, demo excluded. Listing-promotion drafts an ad within 24h of a new listing (idempotent via `ad_promoted_at`); seller-lead ad refresh; open-house promote/remind/follow-up (reminders keep running even with AI paused); 3×/day content posts (deduped per slot).

---

## 4. Event triggers, webhooks & retries (non-cron)

These are **request-driven**, not cron — included per spec (event triggers / webhooks / retry processes):

- **Outbound webhooks (Zapier etc.):** `controllers/zapierController.triggerWebhook` + `utils/webhookDispatcher.js`. Delivers a payload to a stored `webhook_url` with **retry on failure** and **SSRF guard** (`assertSafeWebhookTarget`, line 46) before `fetch`. Fired fire-and-forget from jobs like weekly-analytics.
- **Inbound webhooks (routes/webhookRoutes.js):** Stripe billing events, Twilio voice/SMS status + inbound (`config/twilio.validateTwilioRequest` verifies X-Twilio-Signature; `finalizeCallCost` reconciles real call minutes into the usage ledger). Facebook/OAuth callbacks under their route files. Verified signature handling exists for Twilio; Stripe webhook signature verification should be confirmed in `subscriptionController`/`webhookRoutes` (see external doc).
- **FCM / Web Push delivery:** `config/fcm.sendToTokens` (HTTP `https://fcm.googleapis.com/fcm/send` **legacy API** — see risk below) and `config/webpush` (`web-push`/VAPID, with push-endpoint allowlist). Both **no-op gracefully when unconfigured**. Invalid tokens are returned for pruning.
- **Job queue (`utils/jobQueue.js`):** DB-backed claim table with `FOR UPDATE SKIP LOCKED` drain + `rescueStaleClaims()`. Only used by Sage sweeps when `SAGE_V2_JOB_QUEUE` is ON (**default OFF**). Not a general-purpose queue; there is **no Redis/Bull/SQS** in the stack.

---

## 5. Silent-failure & reliability risks (honest list)

1. **Single-process crons.** All 42 jobs run in the web process (`server.js` line 462). If the process is down, restarting, or scaled to zero, **every minute-level job (publish, reminders) silently misses ticks** until restart. `social-publish` mitigates partly via the 10-min stuck-`publishing` reclaim, but a missed minute is simply late.
2. **Per-brand errors only hit `console.error`.** Most sweeps swallow individual failures. Unless someone reads server logs, a brand whose weekly report or publish repeatedly fails may go unnoticed. Sage jobs are better (persist `finishRun "failed"`).
3. **FCM legacy endpoint.** `config/fcm.js` uses `https://fcm.googleapis.com/fcm/send` with `Authorization: key=SERVER_KEY` — the **legacy FCM HTTP API, which Google has deprecated/retired**. Mobile push may **silently return non-2xx and count as failed** (`fcm.js` lines 68–71) even when configured. **Flag for reviewer / likely broken.** (Web Push via VAPID is the modern path and is separate.)
4. **Many AI jobs OFF by default.** Anyone assuming weekly analytics/autopilot/autonomous-growth are running will be wrong unless the control switches were flipped on. Live state is **UNVERIFIED** from static code.
5. **External side-effects untested in prod.** Publishing, Twilio calls/SMS, SMTP sends, FCM — the cron fires and marks DB state, but the actual external effect is **Real but untested** end-to-end in production per the review's global rules (Google OAuth is the one verified-on-staging integration). See `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`.
6. **No dead-letter / alerting queue.** Retries are ad-hoc per job (email backoff, social 10-min reclaim, webhook retry). There is no centralized failed-job dashboard beyond `JOBS[]` metadata (`lastRanAt`/`lastSkippedAt`/`lastSkipReason`).
7. **Cron timezone.** All cron expressions use the server clock (UTC on Railway). Owner-facing "daily 6am"/"morning briefing" times are UTC-based at the cron level; per-user timezone handling happens inside runners (`utils/timezone.js`, `utils/timeOfDay.js`) — verify each time-sensitive job honors per-brand TZ (tests exist: `test/contentCalendarDst*.test.js`).

---

## 6. What does NOT exist (verified absence)

- **No separate worker service / dyno.** Grep confirms crons only register in `utils/scheduler.js`, started from `server.js`.
- **No Redis, Bull/BullMQ, RabbitMQ, SQS, or Kafka** in the dependency set used for jobs (the only queue is the Postgres-backed `utils/jobQueue.js`, flag-gated off).
- **No `setInterval`-based background loops in server code** for scheduling — scheduling is exclusively `node-cron`. (`setTimeout` appears only for small delays/backoff, e.g. `utils/email.js` `delay()`, and in client/test files.)

---

*Prepared for outside architect audit — Zorecho Full System Review, 2026-07-24. Automation facts verified against `EchoAI/utils/scheduler.js`, `EchoAI/server.js`, and each named controller/util. Live per-environment on/off state and end-to-end external delivery are labeled UNVERIFIED where not provable from static code.*
