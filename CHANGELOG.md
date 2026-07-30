# CHANGELOG.md — Zorecho

Newest first. Documentation-only entries are marked (docs). For deep milestone history see `MILESTONES.md`.

## 2026-07-27

- REPLIT_PROMPT_003 v2 (code phase done; staging external proof pending owner steps): both launch paths now create the actual Facebook **ad object** (`POST act_<id>/ads`, PAUSED-only via shared `createPausedAd`); fail-fast Page/link guard before ANY FB object in `launchFacebookCampaign`; duplicate-ad guard; partial chains recorded as `status='launch_failed'` with all known ids + surfaced (`partialChain` in API errors, incl. local-persist-failure-after-FB-success); four-object-id log line per launch. Migration `126_facebook_ad_object.sql` (additive: `campaigns.facebook_creative_id`, `campaigns.facebook_ad_id`). +8 tests (`tests/facebookAdObject.test.js`); suite 985→993/993.
- REPLIT_PROMPT_002 v2 **COMPLETE** (live staging verification, zero code changes): Facebook connect on staging.zorecho.com verified end-to-end — SDS2 ad account + South Dixie Storage Page persisted, all 4 live probes green, revoke-and-reconnect proven via integration-row timestamp advance. Phase B unblocked (003/004/006/016).

## 2026-07-30

- REPLIT_PROMPT_005 v2 + owner addendum v3 (code phase done locally; push/PR + staging proof pending): honest campaign lifecycle. Legal states `draft, approved, created_paused, live, completed, failed, launch_failed`; both launch paths now insert `created_paused` (was the dishonest `active`). New `utils/campaignState.js` (single state machine; illegal transitions throw; `created_paused⇔live` reserved to the verification authority via a private token) + `utils/campaignVerification.js` (`verifyCampaignStatus` — the ONLY writer of `live`, both directions, from a GET-only Graph read-back requiring campaign+ad set+EVERY ad `status`+`effective_status` == ACTIVE; failed read-back leaves state unchanged + records `last_verify_error`; success stamps `last_verified_at`). Migration `EchoAI/models/128_campaign_state_machine.sql` (deterministic, no network: all legacy `active`→`created_paused`; `launch_failed` preserved; unexpected values abort loudly; column default →`created_paused`; adds `last_verified_at`/`last_verify_error`). Owner ruling applied: Autonomous Growth never writes `campaigns.status` directly — legacy `paused` writer removed; engine scoped to `live` rows; after its FB pause the local flip happens only via the verification helper. Committed spend counts ONLY `live` (`spendLimits.getBrandSpend`, admin platform stats, AG month-to-date). Presence consumers moved to `IN ('created_paused','live')` (scheduler×3, skipGates×2, portfolio, agents×2, missionControlV2, customerIntelligence×3, capitalFunding, analytics, optimizer, campaign performance/optimize, echoBriefing, realEstateAutomation). dataQualitySentry analytics-coverage sweep narrowed to `live` (paused chains can't produce analytics). UI: Campaigns StatusPill shows "Created (paused at Facebook — will not spend until enabled)" / "Live" (green only after verification); PWA shell cache v156→v157. Tests +16 (`tests/campaignStateMachine.test.js`: state machine, impossible-to-render-live, read-back fail-closed both directions, migration mapping/abort, scheduler + committed-spend regressions); server 998→1014/1014; client 385/385; build green. Grep-proof: diff adds zero mutating Graph calls.

## 2026-07-29

- REPLIT_PROMPT_004 v3 (COMPLETE, D-20 Option C; PR #16 merged to `staging`, deployed `a65e2f5`, live-verified on SDS2 with `FACEBOOK_LINK_URL` removed from Railway; PWA shell cache v155→v156): per-brand Facebook Page + ad destination link. Migration `127_brand_ad_destination.sql` (additive `brands.facebook_page_id`, `brands.ad_link_url`; backfill copies owner's `page_ref` into their brands and `website_url`→`ad_link_url`; never overwrites; logs row counts). Both launch paths (`launchFacebookCampaign`, Ad Creative Studio `launchCreative`) resolve Page+link ONLY from brand columns via shared `resolveBrandAdDestination` — env vars never read, revoked/no-longer-granted Page ⇒ honest 503 with reconnect guidance, fail-fast before any Graph call. Echo companion + Setup Agent creative-launch gating moved from env vars to brand columns + live connection. `POST /api/facebook/select-page` accepts `brandId` (ownership-checked) and writes the brand's Page; `page_ref` kept as wizard default suggestion only. `updateBrand` accepts `adLinkUrl` (URL-validated) + `facebookPageId` (granted-list-validated); Sage business-links card gained the ad-destination field. Tests reworked to brand-column fixtures with misleading env values proving env is ignored; +4 tests (two-brand isolation shared + studio, revoked-page 503, unconfigured studio 503). Server suite 994→998/998; client 385/385; client build green.
- REPLIT_PROMPT_003 v2 **COMPLETE**: staging PAUSED-chain external proof done — full campaign→ad set→creative→ad chain created PAUSED on SDS2, verified Off/$0 in Ads Manager, all 6 test campaigns deleted, zero spend. Five follow-up PRs (#10–#14) merged to `staging` for mid-2026 Facebook Graph API required fields: Graph error detail surfacing; `is_adset_budget_sharing_enabled:false` (campaign); `bid_strategy:"LOWEST_COST_WITHOUT_CAP"`, `targeting_automation.advantage_audience:0`, `promoted_object:{page_id}` (ad set) — both launch paths. Prereqs: `FACEBOOK_LINK_URL` env var on staging; Meta app published to Live. Suite 993/993 on every PR.

## 2026-07-26

- REPLIT_PROMPT_008 v2 **COMPLETE**: legacy-FCM mobile push honestly disabled — retired endpoint unreachable (`FCM_LEGACY_ENABLED` default off, boot warning, no-op with `reason:'legacy_endpoint_disabled'`); register API copy "Mobile push is not available yet"; token registration retained; web push untouched. +3 tests; suite 985/985.
- REPLIT_PROMPT_014 **COMPLETE**: tenant-isolation regression suite added — `EchoAI/tests/tenantIsolation.{core,surfaces,background}.test.js` (20 tests, incl. background tier-gate test). Zero cross-tenant defects found; no application code changed. Server suite 982/982.

## 2026-07-25

- REPLIT_PROMPT_013 **COMPLETE**: `tests/dbGuard.js` preload now supplies test-only fake defaults for ENCRYPTION_KEY, ANTHROPIC/OPENAI/ELEVENLABS keys, JWT_SECRET, SESSION_SECRET (production-guarded; real values win); README documents the one-command run. Suite 962/962 green with and without env vars.

- REPLIT_PROMPT_001 v2 **COMPLETE**: verification-only (no code gaps). Added `test/encryptionRoundTrip.test.js` + `test/stripeWebhookSignature.test.js` (11 tests); server suite 962/962 green; staging SQL ciphertext check PASSED on all 4 token columns.

- (docs) REPLIT_PROMPT_012 (Backup & Baseline) closed as **COMPLETE**. Continuity documents introduced: `CURRENT_STATE.md`, `COMPLETED_WORK.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`, `TEST_EVIDENCE_INDEX.md`.
- (docs) `ROLLBACK.md` §1/§2 updated with the actual GitHub tag/branch creation and Railway backup IDs (prod 22:56 UTC 940 MB; staging 22:58 UTC 885 MB).
- Ops: removed stale `.git/refs/tags/pre-turnaround-baseline.lock` that blocked Git panel pushes (INDEX_LOCKED).
- GitHub: tag `pre-turnaround-baseline` published; branch `backup/pre-turnaround` created (by James).
- (docs) `ROLLBACK.md` created with restore-drill evidence (dev DB dump/restore, 0 errors, schema fully current).

## 2026-07-24

- Review package `ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24.zip` built for outside architect review (docs + sanitized source; secret-scanned).
- Brand profile saving & error handling improved; Echo constrained to English during brand discovery (see git history for the full day's commits).

## Before 2026-07-24

See `MILESTONES.md` (Sage V2 Phases 1–6, Department Collaboration Stage 0) and git history (`git log`).
