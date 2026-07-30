# TEST_EVIDENCE_INDEX.md — Zorecho Test & Verification Evidence Index

 Per the Evidence rule (`replit.md`), every functional claim needs recorded proof. This file indexes where each piece of evidence lives. Newest first.

**Last updated:** 2026-07-30.

## 2026-07-30 — Prompt 015 code phase (dev environment)

| Check | Result | Evidence |
|---|---|---|
| Server suite | PASS — **1035/1035** (baseline 1014 + 21 new) | `npm test` in `EchoAI/` (node --test) |
| New suite `tests/spendCapControls.test.js` | 21 tests: deny-by-default (no brand cap / no platform row / brand SUM / platform SUM), term-6 pending sums, denial = audit row + ZERO Graph calls, atomic compensation (order ad→adset→campaign, PAUSED re-pause bodies, marker NULL), idempotent no-ops (no Graph, no audit), pause campaign-first + marker clear (incl. partial-failure regression pair), refresh recognition-only (zero POSTs), tenant isolation 404s, launch-path ACTIVE grep-proof, money round-trips incl. NUMERIC strings | test file + suite output |
| Client suite / build | PASS — 385/385; vite build green (sw v158 in dist) | `npm test` in client; `npm run build:client` |
| Migration 129 | Applied to dev (`+ applied 129_ad_spend_caps.sql`, platform row = 2500¢ verified) and test DB (pretest runner) | migration runner output + psql check |
| Architect review | 1 critical finding (stale pending marker on partial pause) — fixed, 2 regression tests added, suite re-run green | review transcript in session |
| Staging denial proof | **PENDING owner steps** — unpause without cap ⇒ denial screenshot + `ad_spend_audit` `result='denied'` row via read-only `$STAGING_DATABASE_URL`; NO real unpause-to-spend (D-7) | to be recorded here after merge/deploy |

## 2026-07-30 — Prompt 005 staging live proof (SDS2)

| Check | Result | Evidence |
|---|---|---|
| Deploy SHA = PR #17 merge | PASS — `/api/health` `6a5e508` (parents `a65e2f5`+`bc6ee20`) | curl + GitHub API |
| Migration 128 on staging | PASS — 2 `active`→`created_paused`, 7 `launch_failed` preserved, 0 other; new columns + default `created_paused` | staging DB read-only query |
| Launch ends `created_paused` | PASS — row `626851f3…`: full FB chain `120249449573260774`→`120249449573460774`→`920566577037015`→`120249449574540774`, $5, `last_verified_at`/`last_verify_error` NULL | staging DB + owner screenshot |
| Required UI copy | PASS — amber "Created (paused at Facebook — will not spend until enabled)" on new + both migrated rows; no green Live anywhere | owner screenshot |
| Ads Manager matches | PASS — campaign Off, no delivery, $0 spent; 3 pre-existing drafts untouched | owner screenshot |
| Chain deleted, zero spend | PASS — deletion published ("1 campaign was published" = Ads Manager applying the delete edit); list back to 3 drafts; account $0 | owner screenshot |
| Ad Creative Studio truncation fix (PR #18, `cc94b78`) | PASS — root cause reproduced locally (parse fail + missing-body-copy), 3/3 clean after max_tokens 8192 + honest truncation 502 | local curl runs, suite 1014/1014 |

## 2026-07-30 — Prompt 005 code phase (local)

| Check | Result | Evidence |
|---|---|---|
| Server suite after state machine + consumer updates | PASS — 1014/1014 (998 baseline + 16 new) | `cd EchoAI && npm test`, 2026-07-30; new file `tests/campaignStateMachine.test.js` |
| Client suite + build | PASS — 385/385; vite build green; shell cache v157 | `cd EchoAI/client && npx vitest run`; `npm run build:client` |
| Impossible-to-render-live | PASS — direct `created_paused→live` write throws without the verification authority; read-back fail-closed both directions | tests: "IMPOSSIBLE-TO-RENDER-LIVE…", read-back tests in `campaignStateMachine.test.js` |
| Migration 128 mapping | PASS — dev DB: 9 `active`→9 `created_paused`, 0 unexpected; staging preflight counts: 2 `active`, 7 `launch_failed`, 0 other | `node utils/runMigrations.js` output + read-only staging query, 2026-07-30 |
| Recognition-only (no mutating Graph calls added) | PASS — grep over full diff: zero `graphPost`/POST additions | grep-proof, 2026-07-30 |
| Architect review round | DONE — 2 findings fixed (weekly-analytics discovery, admin spend `live`-only), re-run 1014/1014 | review notes, 2026-07-30 |

## 2026-07-29 — Prompt 004 v3 staging live proof (SDS2)

| Check | Result | Evidence |
|---|---|---|
| Deploy SHA = PR #16 merge | PASS — `/api/health` version `a65e2f5` (parents `add2ecda`+`1565a353`) | curl + GitHub API, 2026-07-29 |
| Migration 127 + backfill on staging | PASS — brand columns exist; Pole Barn Kits got Page `140006069194366` from `page_ref`, `ad_link_url` NULL (no website stored — correct, never fabricated) | staging DB read-only query |
| App healthy with `FACEBOOK_LINK_URL` deleted from Railway | PASS — health OK across redeploy | curl polls |
| Unconfigured brand launch → honest 503, zero FB objects | PASS — "This brand has no ad destination link. Add a website / destination link in the brand's settings, then try again."; 0 new campaigns rows; creative stayed `draft`, no FB ids | owner screenshot + staging DB |
| Configured brand launch from brand data only | PASS — full PAUSED chain: campaign `120249425003060774` → ad set `120249425003620774` → creative `1511205266964014` → ad `120249425006940774`; brand row shows Page `140006069194366` + `https://polebarnkits.com/` (env var already gone) | staging DB + owner screenshots |
| Ads Manager: Off/$0, chain deleted | PASS — campaign Off, no spend; "Campaign deleted — 1 campaign was deleted"; account total $0 | owner screenshots, 2026-07-29 |

## 2026-07-29 — Prompt 004 v3 code phase (per-brand Page + link, D-20 Option C)

| Check | Result | Evidence |
|---|---|---|
| Zero env reads (`FACEBOOK_PAGE_ID`/`FACEBOOK_LINK_URL`) in server code | PASS — grep across controllers/utils/jobs/middleware/routes returns NONE | grep run 2026-07-29, Replit dev |
| Zero `page_ref` reads in launch paths | PASS — only comments mention it | same grep run |
| Env values cannot influence launches | PASS — suite runs with misleading env values set; Graph captures assert brand values | `tests/facebookAdObject.test.js` before() hook |
| Two-brand same-user isolation (shared launcher) | PASS — each chain's promoted_object, object_story_spec.page_id, link_data.link, CTA link match ITS brand | "two-brand isolation" test |
| Two-brand isolation (Ad Creative Studio) | PASS | "studio two-brand isolation" test |
| Revoked / no-longer-granted Page | PASS — 503 reconnect guidance, zero Graph calls | "brand Page no longer in the granted list" test |
| Unconfigured brand (no page/link) | PASS — 503, zero Graph calls, no campaign row | fail-fast + studio-unconfigured tests |
| Prompt 003 regression (4 Graph POSTs, PAUSED, mid-2026 fields) | PASS — unchanged assertions still green | same file, happy-path + studio tests |
| Server suite | **998/998** PASS (994 + 4 new) | `cd EchoAI && npm test`, 2026-07-29, Replit dev |
| Client suite / production build | **385/385** PASS / build green | `npm test` (client), `npm run build:client`, 2026-07-29 |
| Migration 127 applies cleanly (dev + test DB) | PASS — "1 applied, 131 skipped"; backfill row counts logged | runMigrations + setupTestDb output, 2026-07-29 |

## 2026-07-29 — Prompt 003 v2 staging external proof (PAUSED chain on SDS2)

| Check | Result | Evidence |
|---|---|---|
| Full PAUSED chain created via Ad Creative Studio launch | PASS — "Creative launched to Facebook (paused for review)" | Staging DB `campaigns` row `1db22694-...` (2026-07-29 15:24 UTC): campaign `120249420223810774`, ad set `120249420224360774`, creative `1408353584447141`, ad `120249420227100774` |
| Ads Manager verification (SDS2) | PASS — all 6 test campaigns Off, $0.00 spent, "0 active campaigns" | Owner screenshots, 2026-07-29 session |
| Chain deletion | PASS — "Multiple items deleted: 6 campaigns were deleted" | Owner screenshot, 2026-07-29; only pre-existing Marketplace drafts remain |
| Zero spend | PASS — Amount spent $0 across all rows and account total | Same screenshots |
| Server suite on each follow-up PR (#10–#14) | 993/993 PASS ×4 runs | `cd EchoAI && npm test`, 2026-07-28/29, Replit dev |
| Regression lock added post-review: assertions for all 4 new Graph create fields (both paths) + Graph error-composition unit test | 994/994 PASS | `tests/facebookAdObject.test.js` (9 tests), full suite 2026-07-29 |

## 2026-07-27 — Prompt 003 v2 (Facebook ad object in both launch paths)

| Check | Result | Evidence |
|---|---|---|
| Preflight: no `/ads` POST anywhere; both paths stop after creative | REPRODUCED | grep across controllers/utils; `campaignController.js` (old ~152–214), `adCreativeStudioController.js` (old ~402–475) |
| Preflight: silent partial chain | REPRODUCED | old `launchFacebookCampaign` skipped the creative when Page/link env missing — campaign+adset created undeliverable, row saved `'active'` |
| Four linked POSTs incl. PAUSED `/ads`, ids persisted (manual path) | PASS | `EchoAI/tests/facebookAdObject.test.js` "happy path" (mocked Graph; adset_id/creative linkage + PAUSED asserted) |
| Same for Ad Creative Studio path | PASS | "studio path: four linked POSTs…" |
| Fail-fast: 0 Graph calls, no row, on missing Page/link | PASS | "fail-fast" test |
| Partial `/ads` failure → `launch_failed` row + surfaced `partialChain` (both paths + manual API body) | PASS | 3 partial-failure tests |
| Duplicate-ad guard: no second `/ads` POST | PASS | "duplicate guard" test |
| Tenant isolation: chain uses only the caller's stored token | PASS | happy-path access_token assertion |
| Single launch path (Autopilot = manual) | PASS | source-assertion test; `autopilotController.js:1214` |
| Full suite | 993/993 (985 + 8) | `/tmp/prompt003_full_run.log` |
| Staging external proof (Ads Manager paused chain screenshot, delete chain, zero spend) | **PENDING** | owner steps |

## 2026-07-27 — Prompt 002 v2 (Facebook staging connect + Page + ad-account selection)

| Check | Result | Evidence |
|---|---|---|
| Staging on accepted code | VERIFIED | /api/health version `62ea1fc`; `git merge-base --is-ancestor` confirms a106744 + bf12db8 contained |
| App ID match | VERIFIED | Meta app 1747619749738868 = Railway FACEBOOK_APP_ID (owner screenshots) |
| Redirect URI | VERIFIED | Meta Valid OAuth Redirect URIs + FACEBOOK_REDIRECT_URI both exactly `https://staging.zorecho.com/api/facebook/oauth/callback` |
| Scopes at first consent | VERIFIED | facebookOAuthController SCOPES = the 6 required incl. ads_management; auth_type=rerequest |
| Connected probe green | VERIFIED | wizard verify: 4/4 green (owner screenshot, pre- and post-reconnect) |
| page_ref persisted/resolvable | VERIFIED | staging DB: page_ref=South Dixie Storage page id; = facebook_pages[0].id post-reconnect |
| ad-account ref persisted | VERIFIED | account_ref `act_8186…` (SDS2 · USD · Active on connected card) |
| providerVerification | VERIFIED | connected row present → facebook:true (fails-closed design); live probes green |
| Reconnect after revoke | VERIFIED | FB Business Integrations removal (owner screenshot of dialog) → reconnect → row updated_at 2026-07-24 17:44 → 2026-07-27 14:57 UTC, refs intact, tokens refreshed |
| Consent screenshot | UNVERIFIED (owner-attested) | not captured during reconnect; DB round-trip proof stands in |
| Code changes / migration | NONE | zero diff; all columns pre-existing |
| Token encryption | VERIFIED | tokens stored via encrypt() (Prompt 001 path); api_token_encrypted + facebook_page_tokens non-null |

## 2026-07-26 — Prompt 008 v2 (disable legacy-FCM mobile push)

| Check | Result | Evidence |
|---|---|---|
| Preflight: legacy endpoint reachable pre-change | REPRODUCED | `config/fcm.js:14` (`fcm.googleapis.com/fcm/send`); reachable when `FCM_SERVER_KEY` set; failures counted, never thrown |
| Preflight: caller enumeration | DONE | `sendToTokens` sole caller: `mobilePushController.sendToUser:121`; `sendToUser` called from 14 best-effort alert sites; zero web-UI mentions of mobile push (grep) |
| Endpoint unreachable after change (fetch tripwire, server key set) | 3/3 PASS | `EchoAI/tests/mobilePushDisabled.test.js` — `{skipped:true, reason:'legacy_endpoint_disabled'}`, 0 fetch calls |
| Grep proof: no code path to legacy endpoint | VERIFIED | `fcm.googleapis.com` appears only in `config/fcm.js` (behind the default-off flag), a webpush comment, and the test comment |
| Honest surface | VERIFIED | register API: "Device registered. Mobile push is not available yet." + `mobilePushAvailable:false`; no web UI to screenshot (mobile push has no web surface — API response IS the surface) |
| Web push untouched | VERIFIED | zero changes to `config/webpush.js`, `client/src/push.js`, `client/public/sw.js` |
| Full server suite | 985/985 PASS | `/tmp/prompt008_full_run.log`, `npm test`, 2026-07-26 |
| Architect review | PASS (no alternate send path; callers best-effort-safe) | review round 2026-07-26 |
| Rollback | `FCM_LEGACY_ENABLED=true` re-enable flag | `config/fcm.js` comment block |

## 2026-07-26 — Prompt 014 (tenant-isolation regression suite)

| Check | Result | Evidence |
|---|---|---|
| Preflight: prereq 012 satisfied | VERIFIED | `CURRENT_STATE.md` Baseline section, `ROLLBACK.md` §2/§3 |
| Preflight: tenant-scoped surfaces enumerated | DONE | user-scoped: users, subscriptions, brands, api_integrations, guided_setup_progress; brand-scoped: leads, campaigns, social_posts/accounts, email_marketing_*, ad_creatives, sage_*, goals — route/middleware map recorded in this session |
| Direct-id cross-tenant probing (brands, campaigns, leads, social_posts, ad_creatives) | 10/10 PASS — 403/404, zero leakage (secret-marker body checks + DB re-reads) | `EchoAI/tests/tenantIsolation.core.test.js` |
| Email, integrations, setup sessions, guided progress, Sage endpoints + team-member remap (viewer reads owner data, blocked from admin/mutations) | 6/6 PASS | `EchoAI/tests/tenantIsolation.surfaces.test.js` |
| Background is_demo gating (publishDuePosts, runDailyGoalTracking) + Sage single-brand delivery (runUrgentScanForBrand writes scoped to one brand) | 3/3 PASS | `EchoAI/tests/tenantIsolation.background.test.js` |
| Background TIER gating: `maybeStartSequenceForLead` enforces the Pro gate itself (Starter brand: 0 sequences created; Pro brand: 1) — encodes the "background paths bypassing route gates" lesson in full | 1/1 PASS | `EchoAI/tests/tenantIsolation.background.test.js` test #4; gate at `controllers/followUpController.js:66-78`, invoked at :737 |
| "Client active-brand copies" class — encoded control | Server-side denial of any foreign brand-id is the isolation control (core+surfaces probes; team-member remap test proves even a remapped user's stale brand-id can't cross workspaces). The recorded App.jsx bug was WITHIN-tenant display staleness, not cross-tenant access — no client test needed for isolation | core/surfaces suites; justification in `COMPLETED_WORK.md` 2026-07-26 entry |
| Cross-tenant defects found | **NONE FOUND** — no application code changed | all probes denied with no data in bodies |
| Full server suite after adding 20 tests | 982/982 PASS | `/tmp/prompt014_full_run2.log`, `npm test`, 2026-07-26 |
| Architect review | PASS (no severe gaps; suite non-vacuous, cleanup safe) | review round 2026-07-26 |

## 2026-07-25 — Prompt 013 (test-environment bootstrap & suite hygiene)

| Check | Result | Evidence |
|---|---|---|
| Preflight repro: full suite with ANTHROPIC/OPENAI/ELEVENLABS/ENCRYPTION keys unset | 45/962 FAIL reproduced (incl. `publishDuePosts forwards video_url`) | `/tmp/clean_env_run1.log`, 2026-07-25 |
| Root cause identified | Env dependency, not cross-file leak: `node --test` isolates each file in a child process; the video_url test seeds fixtures via real `encrypt()`, which throws without ENCRYPTION_KEY | socialMediaUpload.test.js:176; fails alone too without the key |
| Fix: TEST-ONLY dummy defaults in `tests/dbGuard.js` preload (6 vars incl. JWT_SECRET + SESSION_SECRET, after production hard-fail; real values always win) | Implemented | dbGuard.js diff |
| Full suite, ALL six env vars stripped (clean-checkout simulation) | 962/962 PASS | `/tmp/clean_env_run3.log` |
| Full suite, real env vars set | 962/962 PASS | `/tmp/normal_env_run.log` |
| Previously order-sensitive test green inside the full clean run | PASS | 0 failures in clean run |
| Architect review | PASS after fixing flagged JWT_SECRET/README gap | review round 2026-07-25 |
| README documents the one-command run | DONE | `EchoAI/README.md` Testing section |

## 2026-07-25 — Prompt 001 v2 (token encryption + Stripe webhook signatures)

| Check | Result | Evidence |
|---|---|---|
| Preflight: all api_integrations/google_integrations token writes use `encrypt()` | VERIFIED | facebookOAuthController.js:205/209/313, campaignController.js:101, googleController.js:126/235-236 |
| Preflight: all token reads use `decrypt()` (no plaintext fallback) | VERIFIED | campaignController.js:43, facebookOAuthController.js:286/299/447, socialController.js:192, googleController.js:96/100 |
| Preflight: ENCRYPTION_KEY boot-critical | VERIFIED | config/env.js:18 (CRITICAL array; validateEnv throws) |
| Preflight: Stripe webhook uses `constructEvent` + raw body, 400 before any state change, no bypass path | VERIFIED | subscriptionController.js:229-236, subscriptionRoutes.js:16-20, server.js:214-216 |
| Encrypt round-trip + tamper/wrong-key/plaintext-rejection unit tests | 6/6 PASS | `EchoAI/test/encryptionRoundTrip.test.js` |
| Forged/missing/wrong-secret webhook signature → 400 with ZERO db writes; legit signature → 200 processed | 5/5 PASS | `EchoAI/test/stripeWebhookSignature.test.js` |
| Full server suite after adding tests | 962/962 PASS | `npm test`, 2026-07-25 |
| Staging SQL ciphertext check (`SELECT LEFT(...,10)` on all 4 token columns) | VERIFIED — PASS | Read-only query run 2026-07-25 via `STAGING_DATABASE_URL` against Postgres-v9JE. Results: api_integrations (facebook, connected): `api_token_encrypted` starts `am7pI86hEn`, `facebook_page_tokens` starts `DLj5hBSbp5`; google_integrations (connected): `access_token_encrypted` starts `wOrqSr8wLO`, `refresh_token_encrypted` starts `+p+F9ncvpx`. All base64 ciphertext — no `EAAB...`/`ya29...` plaintext. 1 row per table. |

## 2026-07-25 — Prompt 012 validation run (Replit dev environment)

| Check | Result | Evidence |
|---|---|---|
| Server suite (`cd EchoAI && npm test`) | 951/951 PASS | Automated validation at commit `1be389c2`, 2026-07-25 |
| Client suite (`cd EchoAI/client && npm test`) | 385/385 PASS (34 files) | Same validation run |
| Client production build (`npm run build:client`) | PASS | Same validation run |
| Restore drill (dump → restore → migrate-check → sanity counts) | PASS, 0 errors | `ROLLBACK.md` §3 (full numbers) |
| GitHub tag + branch creation | VERIFIED | James's screenshots, 2026-07-25 session; visible at github.com/19JRB71/EchoAI-Foundation |
| Railway backups (prod + staging) | VERIFIED | James's screenshots, 2026-07-25; IDs in `ROLLBACK.md` §2 |
| Restore drill on a REAL Railway staging backup | **UNVERIFIED** — operational follow-up | Will be recorded here when run |

## Standing baselines

- `ROLLBACK.md` §4 — baseline test results recorded 2026-07-24/25.
- `review_package/docs/TESTING_CURRENT_STATE.md` (inside `ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24.zip`) — full testing-state document as of the review package.
- `COLLAB_STAGE0_COMPLETION_REPORT.md` — Stage 0 test evidence (925 server / 372 client at that date).
- Sage V2 phase evidence — each `SAGE_V2_PHASE*_ARCHITECTURE.md` / completion report.

## How to add entries

At the close of each prompt, append a dated section with: the exact command run, the result counts, the date, the environment, and where the raw log or screenshot lives. Never cite a previous summary as proof — re-verify against current code.
