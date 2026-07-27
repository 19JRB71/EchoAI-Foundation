# OPEN TECHNICAL QUESTIONS FOR THE REVIEWER

**Package:** ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24

These are the areas where the current implementation or intent could NOT be
confirmed from the code alone during this review. Each entry states the unclear
area, the relevant file paths, what the code appears to do, what could not be
confirmed, and what the outside reviewer should investigate. Nothing here is
guessed — where the answer is unknown it is labeled **UNKNOWN**.

---

## Q1. Do external actions actually reach their target services in production?
- **Files:** `utils/facebookApi.js`, `utils/socialApi.js`, `utils/email.js`,
  `utils/phone.js`, `controllers/subscriptionController.js`,
  `utils/webhookDispatcher.js`, `utils/elevenlabs.js`.
- **Appears to do:** call real Facebook Graph, Twilio, nodemailer/SMTP, Stripe,
  web-push, Google, ElevenLabs, OpenAI image, and Jobber APIs.
- **Cannot confirm:** whether any of these external effects (a live FB post/ad,
  a real Twilio call/SMS, a real Stripe charge, a delivered email, a delivered
  push) has actually succeeded end-to-end in staging or prod. Unit tests stub
  them. Google OAuth *connect* was verified on staging 2026-07-23; downstream API
  *reads/writes* were not.
- **Investigate:** run controlled, non-billing test transactions per integration
  on staging and capture provider-side confirmation (message SIDs, post IDs,
  Stripe event IDs). See `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`.

## Q2. Which Mission Control is authoritative?
- **Files:** `client/src/sections/MissionControl.jsx` vs
  `client/src/missioncontrol/MissionControlV2.jsx` (+ their separate test files).
- **Appears to do:** both render a mission-control dashboard.
- **Cannot confirm:** which is actually mounted in the live nav, and whether V1
  is dead code.
- **Investigate:** trace `client/src/App.jsx` routing and the sidebar/department
  mapping in `client/src/lib/departments.js` (`missioncontrol` section).

## Q3. Same-numbered migrations — is apply order safe?
- **Files:** duplicate prefixes `054`, `067`, `068`, `071`, `090`, `096` in
  `EchoAI/models/`; runner `utils/runMigrations.js`.
- **Appears to do:** apply all `*.sql` in lexical filename order, tracked in
  `schema_migrations`.
- **Cannot confirm:** whether any same-numbered pair has an ordering dependency
  that the filename sort might violate on a fresh DB.
- **Investigate:** inspect each pair for cross-references (columns/tables one
  needs from the other) and confirm a clean-DB migration run.

## Q4. Status of the Department Collaboration bus — is it truly inactive?
- **Files:** `utils/collaborationBus.js`, `utils/directiveBus.js`,
  `models/122_collaboration_bus.sql`; memory `echoai-dept-collaboration.md`.
- **Appears to do:** Stage-0 shared bus/registry, built "dark" behind `COLLAB_*`
  flags that are OFF.
- **Cannot confirm:** whether any live code path reads/writes the bus regardless
  of the flags, and what Stage 1 would activate.
- **Investigate:** grep `COLLAB_` flag reads and confirm no active writer bypasses
  the flag gate.

## Q5. Real depth of the voice / conversational subsystem.
- **Files:** `client/src/voice/*`, `sections/CoreLab.jsx`, `/api/echo-voice`,
  `/api/core-lab`, `utils/conversationalCore.js`, `config/hermes.js`.
- **Appears to do:** always-on "Hey Echo" voice, TTS/STT, Hermes decision brain,
  a flag-off Conversational Core prototype.
- **Cannot confirm:** which voice capabilities are live for real customers vs
  prototype/flag-off, given mic is blocked in the preview and tests cannot
  exercise real browser audio APIs. **UNKNOWN** production reliability.
- **Investigate:** live browser session on staging; review flag defaults in
  `config/env.js` / `config/environment.js`.

## Q6. Hermes / Nous integration — configured and reachable?
- **Files:** `config/hermes.js`, `utils/autonomousConversationBrain.js`,
  `echoOrchestrator.js`; memory `echoai-hermes-brain.md`.
- **Appears to do:** Hermes 4 decides intent/routing on a ~6s single-attempt
  budget, returns null on any failure (fails soft to Claude).
- **Cannot confirm:** whether the Hermes/Nous endpoint is actually configured and
  responding in any environment, or whether it silently returns null always.
- **Investigate:** check the Hermes env vars (see `ENVIRONMENT_AND_INTEGRATIONS.md`)
  and log whether `decide()` ever returns non-null in staging.

## Q7. Are all background schedulers actually running in production?
- **Files:** `utils/scheduler.js`, and callers using `setInterval`/cron; boot in
  `server.js`. See `AUTOMATION_AND_BACKGROUND_JOBS.md`.
- **Appears to do:** hourly health sweep, content publish cron, weekly reports,
  Monday Autopilot study + Self-Review, goal snapshots, failure-alert sweeps,
  connection re-verify.
- **Cannot confirm:** that these fire on Railway (single instance? multiple?
  would multiple instances double-run jobs?), and whether any silently no-op.
- **Investigate:** confirm Railway instance count and single-runner guarantees;
  inspect logs for scheduler heartbeats.

## Q8. ROI figures — modeled estimate vs measured actuals?
- **Files:** `config/roiModel.js`, `controllers/roiController.js`,
  `roiDashboardController.js`; migrations `019`, `038`.
- **Appears to do:** compute activity-based ROI estimates.
- **Cannot confirm:** how much of the ROI number is derived from real
  spend/conversion data vs modeled coefficients. Risk of presenting estimates as
  measured results.
- **Investigate:** trace each ROI input to its data source; label estimated vs
  actual in the UI.

## Q9. Mobile app (v2) — is `/api/v2` a real shipped surface?
- **Files:** `EchoAI-Mobile/` (RN scaffold), `/api/v2` routes/controllers,
  `models/027_mobile_tokens.sql`.
- **Appears to do:** provide a native-app backend.
- **Cannot confirm:** whether any built/distributed mobile client uses it, or if
  it is scaffold-only.
- **Investigate:** confirm build/distribution status of `EchoAI-Mobile/`.

## Q10. Which brand-type verticals are fully supported end-to-end?
- **Files:** `models/076_political_campaign.sql`, `077_real_estate.sql`,
  `utils/politicalContext.js`, `realEstateContext.js`, `realEstateAutomation.js`;
  `sections/Supporters.jsx`, `Properties.jsx`.
- **Appears to do:** gate Voter CRM (political) and Property CRM (real estate) by
  `brand_type`.
- **Cannot confirm:** whether every downstream feature (ads, content, campaigns)
  correctly branches on brand_type, or only the two CRM sections do.
- **Investigate:** grep `brand_type` usage and confirm coverage.

## Q11. Payment / seat billing edge cases in production Stripe.
- **Files:** `controllers/subscriptionController.js`, `utils/spendLimits.js`,
  `config/plans.js`; memory `echoai-seat-billing-sync.md`.
- **Appears to do:** upgrade-instant/downgrade-deferred, one seat line item,
  webhook-driven `pending_tier` application.
- **Cannot confirm:** behavior under real proration, failed payments
  (`billing-lockout-recovery.md`), and mid-cycle team-size changes in live Stripe.
- **Investigate:** Stripe test-mode scenarios covering upgrade, downgrade,
  seat add/remove, and payment failure → lockout → recovery.

## Q12. Uploads persistence after deploy.
- **Files:** `utils/storedFiles.js`, `visionFiles.js`, `models/113_stored_files.sql`,
  `112_vision_image_data.sql`; memory `echoai-ephemeral-uploads.md`.
- **Appears to do:** store files in Postgres BYTEA with disk cache; Railway wipes
  `uploads/` per deploy.
- **Cannot confirm:** that every upload path (post media, images, vision, support
  screenshots) actually persists to BYTEA rather than only disk.
- **Investigate:** grep all `uploads/` writers and confirm each has a BYTEA
  backing write.

## Q13. Prompt-injection and AI-action safety at scale.
- **Files:** `EchoAI/prompts/*`, inline prompts (grep `anthropic.messages`),
  approval gates in autonomous/autopilot controllers.
- **Appears to do:** approval-gate deliverables; Hermes brand-locks topics.
- **Cannot confirm:** robustness against prompt injection from untrusted inputs
  (inbound emails, chatbot messages, competitor page text fed to Sage/Vision).
- **Investigate:** review untrusted-input → prompt paths; see
  `SECURITY_AND_PRIVACY_OVERVIEW.md` and `AI_PROMPT_INVENTORY.md`.

## Q14. Exact deployed commit / state represented by this package.
- **Cannot confirm here:** the precise git commit is captured at packaging time
  by the main agent (T008). This review reflects the working tree as of
  2026-07-24.
- **Investigate:** cross-check `RECENT_DEVELOPMENT_HISTORY.md` and the packaged
  commit hash against the live Railway deploy.
