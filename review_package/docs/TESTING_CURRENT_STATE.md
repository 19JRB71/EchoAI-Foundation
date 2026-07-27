# TESTING_CURRENT_STATE.md

_Zorecho / EchoAI full-system review package — spec §14._
_Prepared 2026-07-24. All claims verified against the current code in `EchoAI/`._

## Summary

| Suite | Location | File count | Runner | Last known state |
|---|---|---|---|---|
| Server unit/integration tests | `EchoAI/tests/*.test.js` | 58 | `node --test` | Passing on 2026-07-24 (Replit dev). See note below. |
| Server tests (second dir) | `EchoAI/test/*.test.js` | 52 | `node --test` | Passing on 2026-07-24 (Replit dev). |
| Client component tests | `EchoAI/client/src/**/*.test.{js,jsx}` | 34 | Vitest | Passing on 2026-07-24 (Replit dev). |

**Note on counts:** The global session notes cite "948 server + 385 client at last full run". Those are *test-case* counts (individual `test()` / `it()` assertions), not files. This document counts **files**: 110 server test files across two directories (`tests/` = 58, `test/` = 52) and 34 client test files. The main agent will attach the fresh, authoritative run output (case counts + pass/fail) alongside this package.

**All numbers above are file counts obtained by listing the directories on 2026-07-24. The pass/fail state is cited from the global review rules (last full run 2026-07-24 in the Replit dev environment) and should be re-confirmed by attaching a fresh run.**

## Test runners & configuration

- **Server:** `npm test` in `EchoAI/` runs `node --require ./tests/dbGuard.js --test "test/**/*.test.js" "tests/**/*.test.js"`. It uses the built-in Node test runner (Node 20.x per `package.json` `engines`).
  - `pretest` hook runs `node tests/setupTestDb.js` — provisions/migrates a **test database** before the suite.
  - `tests/dbGuard.js` is loaded via `--require` to guard against tests hitting a non-test database (safety rail; see `tests/dbGuard.test.js`).
  - Shared helpers: `tests/helpers.js`, `tests/setupTestDb.js`, `tests/resolveTestDb.js`, `test/setupTestDb.js`.
- **Client:** `npm test` in `EchoAI/client/` runs `vitest run` (config `vitest.config.js`, setup `vitest.setup.js`, jsdom environment, `@testing-library/react`).

## Server test files — `EchoAI/tests/` (58 files, incl. helpers)

Test files (coverage area in parentheses):

- `aiCostControls.test.js` (AI budget/gate/ledger cost controls)
- `anthropicRetry.test.js` (Anthropic retry/timeout wrapper)
- `autopilot.logic.test.js` (autopilot scheduling logic)
- `brandDiscoveryAutoSave.test.js` (brand discovery auto-save-on-confirm)
- `collaborationBus.test.js` (department collaboration bus)
- `companyTruth.test.js` (Company Truth / Sage V2 context)
- `competitorAdSpy.test.js` (competitor ad spy)
- `competitorSiteAlerts.test.js` (competitor site alerts)
- `contentCalendarInterview.test.js` (content calendar interview flow)
- `conversationalCore.test.js` (Echo conversational core)
- `creativeModes.test.js` (Forge creative modes)
- `demoSuggestions.test.js` (demo mode suggestions)
- `echoBriefing.logic.test.js` (daily briefing logic)
- `echoContext.test.js` (Echo context assembly)
- `echoEmail.test.js` (Echo email assistant)
- `echoMusicFavorites.test.js` (login music favorites)
- `echoOwnerProfile.test.js` (owner profile)
- `echoPersona.test.js` (Echo persona)
- `echoSectionBrief.test.js` (section briefs)
- `echoVoiceLearnedPhrases.test.js` (voice learned phrases)
- `echoVoiceProfile.test.js` (voice profile)
- `echoVoiceSound.test.js` (voice sound fx)
- `forgeDirector.test.js` (Forge creative director engine)
- `freeTestMode.test.js` (free/test mode gating)
- `geoTargeting.logic.test.js` (geographic targeting logic)
- `goalMetrics.params.test.js` (goal metrics params)
- `guidedSetupVerification.test.js` (guided setup verification)
- `healthMonitor.logic.test.js` (health monitor logic)
- `hermesOrchestrator.test.js` (Hermes orchestration brain)
- `imageResponse.test.js` (image generation response handling)
- `jobber.test.js` (Jobber integration)
- `learningEngine.test.js` (learning engine)
- `missionControlV2.test.js` (Mission Control V2)
- `onlinePresence.test.js` (online presence)
- `patternIntelligence.test.js` (Sage pattern intelligence engine)
- `sageV2.test.js`, `sageV2Phase2.test.js`, `sageV2Phase3.test.js`, `sageV2Phase6.test.js` (Sage V2 phased architecture)
- `salesAgent.logic.test.js` (sales agent logic)
- `selfReview.test.js` (admin self-review)
- `setupAgent.executeError.test.js`, `setupAgent.facebookCampaign.test.js`, `setupAgent.gating.test.js`, `setupAgent.googleAds.test.js`, `setupAgent.health.test.js`, `setupAgent.lease.test.js`, `setupAgent.pauseBeacon.test.js`, `setupAgent.reset.test.js`, `setupAgent.transcribe.test.js` (Setup Agent behaviors)
- `setupReminder.test.js` (setup reminders)
- `storedFiles.test.js` (stored files / media library)
- `timeOfDay.test.js` (time-of-day awareness)
- `visionEngine.test.js`, `visionFiles.test.js` (Vision visual-intelligence agent)
- `voiceContent.test.js` (voice content overlay)
- `workingStyle.test.js` (owner working style)

Helper/support (not test cases): `dbGuard.js`, `dbGuard.test.js`, `helpers.js`, `setupTestDb.js`, `resolveTestDb.js`.

## Server test files — `EchoAI/test/` (52 files)

- `activateBrokenAccount.test.js`, `scheduleBrokenAccount.test.js` (broken social account activation/scheduling)
- `apiQuotaMonitor.test.js` (API quota monitor)
- `autonomousConversation.test.js` (autonomous conversations)
- `autonomousGrowth.test.js`, `growthGuardrails.test.js` (autonomous growth + guardrails)
- `autopilotItemMedia.test.js` (autopilot item media)
- `betaProgram.test.js` (beta program tracking)
- `capitalFunding.test.js` (capital funding section)
- `changePassword.test.js` (password change + session invalidation)
- `competitorSite.test.js` (competitor site monitoring)
- `contentCalendarDst.test.js`, `contentCalendarDstCalendar.test.js`, `contentCalendarDstCalendarIntl.test.js`, `contentCalendarFrequencies.test.js`, `contentCalendarSlots.test.js`, `contentCalendarWindows.test.js` (content calendar scheduling, DST, i18n)
- `deliveryCrons.test.js`, `recurringSweeps.test.js` (scheduled delivery / recurring sweeps)
- `echoInboxContext.test.js`, `echoNavMarker.test.js`, `echoPersonal.test.js`, `echoSuggestions.test.js` (Echo assistant surfaces)
- `echoVoiceClearNotifications.test.js`, `echoVoiceReminders.test.js` (voice notifications/reminders)
- `elevenlabs.test.js` (ElevenLabs TTS integration)
- `emailDripRetry.test.js`, `emailDripRetryAll.test.js`, `emailDripSendError.test.js` (email drip retry/error)
- `emailErrorClassify.test.js`, `emailSmsFailureAlert.test.js`, `socialFailureAlert.test.js`, `failedSendAlerts` (failure alerting — note: `failedSendAlerts.js` util)
- `facebookUnified.test.js` (unified Facebook connection)
- `featureSuggestions.test.js` (feature suggestions)
- `goals.test.js` (goals)
- `guidedSetup.test.js` (guided setup routes)
- `imageReference.test.js` (image reference upload)
- `portfolio.test.js` (portfolio section)
- `publishPostNow.test.js` (publish-now social post)
- `realEstateAutomation.test.js` (real estate automation)
- `sage.test.js`, `sageFeedDismiss.test.js`, `sagePhase4.test.js`, `sagePhase5.test.js` (Sage)
- `scheduledEmailBlast.test.js`, `smsRetryBlast.test.js` (email/SMS blasts + retry)
- `setupAgent.e2e.test.js` (Setup Agent end-to-end within the app; **not** a live-integration e2e)
- `setupStatusSocial.test.js` (setup status for social)
- `socialMediaUpload.test.js`, `socialReschedule.test.js`, `socialReverify.test.js` (social media)
- `subscriptionPublicConfig.test.js` (public subscription config)

## Client test files — `EchoAI/client/src/**` (34 files)

- `App.settingsDeepLink.test.jsx`
- `components/GoalAlertHistory.test.jsx`, `components/GoalEditorCard.mute.test.jsx`, `components/GoalsPanel.muted.test.jsx`, `components/ui/ui.test.jsx`
- `lib/notificationPriority.test.js`, `lib/voiceSettings.test.js`
- `missioncontrol/CoreHero.mute.test.jsx`, `missioncontrol/CoreHero.state.test.jsx`
- `onboarding/SetupAgent.beacon.test.jsx`, `onboarding/SetupAgent.test.jsx`, `onboarding/SetupAgent.voice.test.jsx`
- `sections/CompetitorSites.test.jsx`, `sections/Connections.test.jsx`
- `sections/email/DripSequences.failedRetry.test.jsx`
- `sections/MissionControl.failedPosts.test.jsx`, `sections/MissionControl.goalAlerts.test.jsx`
- `sections/RoiDashboard.goals.test.jsx`
- `sections/Sage.insights.test.jsx`, `sections/SageOpportunities.lifecycle.test.jsx`
- `sections/Settings.focusGoals.test.jsx`
- `sections/SmsMarketing.retryBlast.test.jsx`
- `sections/social/AccountHealthBanner.test.jsx`, `sections/social/AICalendar.reconnect.test.jsx`, `sections/social/AICalendar.reschedule.test.jsx`, `sections/social/ContentCalendar.failedPost.test.jsx`, `sections/social/ContentCalendar.retryBadge.test.jsx`, `sections/social/ReschedulePost.test.jsx`
- `tour/tourNarration.test.js`
- `voice/calibration.test.js`, `voice/conversationHelpers.test.js`, `voice/flightRecorder.test.js`, `voice/phraseVariety.test.js`, `voice/VoicePlayer.test.jsx`

## Coverage areas (what IS tested)

- **AI cost/gate/ledger** logic (`aiCostControls`, budget thresholds, rate limit) — logic-level, with the DB and providers stubbed.
- **AI provider wrappers** — retry/timeout logic (`anthropicRetry`, `hermesOrchestrator`) with the network mocked.
- **Onboarding / Setup Agent** — extensive (gating, transcribe, reset, campaign scaffolding, e2e-within-app).
- **Content calendar & scheduling** — DST, frequencies, windows, slots, recurring sweeps.
- **Social posting flows** — publish-now, reschedule, reverify, failure alerts, broken-account handling (with external SDKs mocked).
- **Email/SMS** — drip retry, send-error classification, blasts, failure alerts.
- **Sage V2** (multiple phases), pattern intelligence, company truth, collaboration bus.
- **Voice** — profile, learned phrases, notifications, reminders, calibration, flight recorder (client).
- **Client UI** — Mission Control, goals, social calendar badges/retry, Setup Agent, Sage sections.

## Untested / weakly covered areas (gaps)

- **NO end-to-end tests against LIVE external integrations.** The test suites mock/stub Facebook Graph, Twilio, Stripe, Google, ElevenLabs, OpenAI, IMAP/SMTP, and web-push. `setupAgent.e2e.test.js` is an in-app flow test, **not** a live-integration e2e. **No test proves a real FB post publishes, a real call/SMS is placed, a real email is delivered, or a real Stripe charge occurs.** (UNVERIFIED end-to-end.)
- **No load/performance tests.**
- **No dedicated security test suite** (auth/roles are exercised indirectly; there is no penetration/authorization-matrix test).
- **Coverage percentage is unknown** — no coverage tooling is wired into `test` scripts (no `c8`/`nyc`/`--coverage`). (UNKNOWN.)
- Client tests concentrate on a subset of sections (Mission Control, social, onboarding, Sage, goals); many sections (e.g. `ImageStudio`, `PhoneAgent`, `AgencyPortal`, `AffiliateProgram`, `ZapierIntegration`) have no dedicated client test file.

## Test accounts / test data

- No hard-coded live test accounts were found in the test files reviewed. Tests provision their own data against the **test database** (`setupTestDb.js`) and tear down/seed as needed.
- Admin seeding exists for the app (`utils/adminSeeder.js`) and demo seeding (`utils/demoSeeder.js`) — these are app utilities, not the automated test fixtures.

## Flaky / disabled / failing tests

- No explicitly skipped/disabled tests (`.skip` / `it.only`) were catalogued during this review. (UNVERIFIED — not exhaustively grepped; the fresh run output the main agent attaches is the authoritative source for skips/failures.)

## Safe-to-run confirmation

The existing suites are designed to run against a **dedicated test database** with all paid/external providers mocked, and are guarded by `tests/dbGuard.js`. They do **not** publish content, launch ads, spend money, send real messages, or modify production data. Per the review constraints, this subagent did **not** execute the suites; the main agent attaches the fresh, non-destructive run output.

## Fresh verification run (attached by main agent)

- **Server suite** (`cd EchoAI && npm test`, node:test against an isolated test database): **951 tests, 951 passed, 0 failed** — run 2026-07-24, Replit development environment (log excerpt retained by the build; summary lines: `tests 951 / pass 951 / fail 0`).
- **Client suite** (`cd EchoAI/client && npm test`, Vitest + Testing Library + jsdom): **34 files, 385 tests, 385 passed, 0 failed** — run 2026-07-24, Replit development environment.
- **Client production build** (`vite build`): succeeded 2026-07-24 (`✓ built in 5.56s`, bundle `dist/assets/index-DAqWNt2A.js`).

These runs verify the mocked/unit/integration behavior only. They do NOT verify live external side effects (Facebook publishing, Twilio calls, Stripe live charges, real email delivery) — see REAL_ACTIONS_VS_SIMULATED_ACTIONS.md.
