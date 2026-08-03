# TEST_EVIDENCE_INDEX.md — Zorecho Test & Verification Evidence Index

 Per the Evidence rule (`replit.md`), every functional claim needs recorded proof. This file indexes where each piece of evidence lives. Newest first.

**Last updated:** 2026-08-03.

## 2026-08-03 — Prompt 019 Stage 2: email-send task spine + Approvals Inbox (pre-merge evidence)

- **Suites:** server 1114/1114 (baseline 1105 + 9 `tests/emailSendSpine.test.js`), client 385/385, client build clean (workflow logs, 2026-08-03). Test DB migration 133 applied via setupTestDb.
- **Grep-proofs:** all five adopted send paths (manual blast, drip, scheduled blasts, CRM sequence, weekly report) converge on `utils/emailSendSpine` (the ONE recorder); no other caller writes email_send tasks.
- **New-test coverage:** full trail w/ `send_accept` proof reference + D-23 evidence redaction (no recipient addresses); Message-ID gate (success w/o IDs can never reach PROVIDER_ACCEPTED); duplicate-send regression BOTH ways (concurrent claim race → one SMTP pass; spine-write failure after SMTP accept → one send, reconciliation task filed, scan never re-sends); total SMTP failure → EXTERNAL_FAILURE; blast reconstruction is honest (REPORTED w/ verification:'unavailable', never invented Message-IDs); stale EXECUTING rescue → MANUAL_REVIEW; inbox aggregation + spine/adapter badging + tenant isolation + deterministic projection; owner-only MANUAL_REVIEW resolution (recorded transition; system actors denied; lost race = 409).
- **Architect review:** PASS, no severe findings (2026-08-03).
- **Staging live proof (one real email → 006 proof inbox, full trail + Message-ID):** PASS — post-merge (PR #26 → staging `68f1a94`) run `prompt019-live-1`: single-recipient one-time blast (campaign `3b706d14`, lead = owner Gmail only, recipient_count 1) via the normal manual-blast path → `{recipients:1, sent:1, failed:0, status:'sent'}`; task `e30037ae` full 7-event trail APPROVED→QUEUED (owner:cb06cf12)→EXECUTING→PROVIDER_ACCEPTED→EXTERNALLY_VERIFIED→REPORTED→COMPLETED (system:email-send); external_proofs `send_accept` row `18cc94aa` (run_key `task-e30037ae…`, external_id = Message-ID `<4463e82a-28f3-fb6e-4308-9ce9936268b2@zorecho.com>`, evidence = messageIds + counts + deliveryConfirmation:'unavailable'); D-23 verified — zero recipient-address matches across all task events (regex sweep, read-only staging DB); inbox delivery confirmed by owner Gmail screenshot (`attached_assets/image_1785766722049.png`), 2026-08-03.
- **Approvals Inbox live evidence (staging `68f1a94`, 2026-08-03):** screenshots `test_evidence/prompt019/approvals-inbox-{pre-resolve,adapter-inventory,post-resolve}.png` — SPINE/ADAPTER badges (D-29.4), counts line "2 waiting · 1 tracked · 1 adapter-backed", expanded 4-adapter inventory with retirement declarations. Determinism: two `GET /api/approvals` calls 2s apart byte-identical (`cmp` on saved bodies); counts cross-checked vs read-only staging DB (exactly 1 MANUAL_REVIEW task platform-wide, owned by admin). I-31 live demo: parked Prompt-009 task `d56721cf` (verification_failed, superseded by PR #24) resolved via the inbox → recorded spine transition MANUAL_REVIEW→COMPLETED, actor `owner:cb06cf12…`, meta `{via:'approvals_inbox', resolution:'confirm_handled', note:…}` (append-only event row, 2026-08-03 14:50 UTC); post-resolve screenshot shows the spine item gone, counts "1 waiting · 0 tracked". Migration 133 confirmed applied on staging (`schema_migrations` row `133_email_send_task_type.sql`).

## 2026-08-02 — Prompt 018: ad-launch task spine (pre-merge evidence)

- **Suites:** server 1105/1105 (baseline 1090 + 15 `tests/adLaunchSpine.test.js`), client 385/385, client build clean (workflow logs, 2026-08-02). Test DB migration 132 applied via setupTestDb.
- **Grep-proofs:** all launch entry points converge on `utils/adLaunchSpine` (§10 single canonical path); `createPausedAd` in `utils/facebookApi.js` remains the ONLY POST `/ads` (regression grep clean).
- **New-test coverage:** full trail w/ proof reference; origin propagation (autopilot/ad_studio/echo/setup_wizard/manual); partial-chain EXTERNAL_FAILURE sharing the source id; pre-chain VALIDATION_FAILED with zero Graph calls; verify-fail -> MANUAL_REVIEW no retry; persist-fail -> PROVIDER_ACCEPTED then MANUAL_REVIEW; completeness gate; §13 spine-throw regression (one launch, one row, scan rebuild with zero provider calls); proof reuse-by-reference; stale-EXECUTING rescue; proof re-link; 015 unpause evidence on the same task.
- **Staging live proof (SDS2 PAUSED chain, $0 spend):** PENDING — runs after owner merges the PR and staging deploys.

## 2026-08-01 — Prompt 009 Stage 2: task spine LIVE PROOF (staging, run prompt009-live-2)

- **Deploys:** PR #23 merged → `df6dad4`; read-back fix PR #24 (`c60084a`) merged → staging `b0fbf61` (health-verified).
- **Live finding (proof run 1, `prompt009-live-1`, post `8e196c38…`):** publish succeeded (FB post `140006069194366_122254752164056707`) but the metrics-based read-back was refused (`pages_read_engagement` not granted) → task `d56721cf…` honestly parked at MANUAL_REVIEW `verification_failed`, provider NOT retried — the designed honesty path, live. Fix (PR #24): verification now uses `socialApi.verifyPostExists` (id/created_time/permalink_url only — the permission profile Prompt 006 already proved). Suite re-verified 1090/1090.
- **Full lifecycle (proof run 2, post `d5f3d371-db1b-42b2-8311-0043e1cba744`):** scheduled via the normal owner flow 23:29:18Z → published by the sweep 23:31:04Z (FB post `140006069194366_122254752710056707`). Task `2b5f0850-d824-4c46-90ca-fa38541c2d5d` trail, every event timestamped + actored (staging DB, read-only):
  - 23:29:18.831 created at APPROVED — `owner:cb06cf12…` (meta platform facebook)
  - 23:29:18.850 APPROVED→QUEUED — `owner:cb06cf12…`
  - 23:31:00.210 QUEUED→EXECUTING — `system:publish-sweep`
  - 23:31:04.886 EXECUTING→PROVIDER_ACCEPTED — `system:publish-sweep` (external_ref set)
  - 23:31:05.298 PROVIDER_ACCEPTED→EXTERNALLY_VERIFIED — `system:publish-sweep` (meta verification=graph_readback)
  - 23:31:05.313 EXTERNALLY_VERIFIED→REPORTED — `system:publish-sweep`
  - 23:31:05.326 REPORTED→COMPLETED — `system:publish-sweep`
- **external_proofs linkage:** task.proof_id = `7b400278-a6c4-43f3-9324-aee10a648614`; row run_key `task-2b5f0850…`, provider facebook / action `publish_readback`, external_id = the FB post id, evidence = live Graph body (id, createdTime 2026-08-01T23:31:00+0000, permalinkUrl facebook.com/122254631936056707/posts/122254752710056707), environment staging.
- **Activity view screenshots:** `test_evidence/prompt009/activity-list.png` (tab with Completed live-2, MANUAL_REVIEW live-1 incl. honest FB error text, and the scan-repaired Prompt-006-era post shown Completed) and `activity-trail-expanded.png` (live-2 expanded: all 7 transitions with timestamps and actors rendered in-app).
- **Owner corroboration:** `test_evidence/prompt009/fb-page-both-posts-live.png` — owner's Manage Page screenshot showing BOTH proof posts live on the South Dixie Storage Page (live-2 "Published by Zorecho · 26m", live-1 "· 35m") before deletion.
- **FB deletion:** DONE 2026-08-01 — owner attested ("done") deleting both test posts from the South Dixie Storage Page. Owner step — the two test posts (live-1 and live-2) deleted manually from the South Dixie Storage Page (spine posts go through the normal flow, so they carry no staging-proof run claim; page token decryptable only on Railway).

## 2026-08-01 — Prompt 009 Stage 2: task spine (code-complete evidence)

- **Suite:** server **1090/1090** = 1071 + 19 (`EchoAI/tests/taskSpine.test.js`). Single-file: `cd EchoAI && node --require ./tests/dbGuard.js --test tests/taskSpine.test.js`. Client 385/385; client build green.
- **Transactional pairing (both directions):** proven with test-only DB triggers that RAISE on agent_task_events INSERT (state change rolls back) and on agent_tasks UPDATE (no orphan event), plus a caller-supplied tx client whose ROLLBACK discards both.
- **Honesty guards tested:** PROVIDER_ACCEPTED→REPORTED refused without meta.verification='unavailable'; illegal targets throw; guarded misses return null with no event; append-only trigger rejects UPDATE/DELETE.
- **Reconciliation tested:** scan rebuilds a published-with-external-id trail through COMPLETED with zero provider calls (fetch + socialApi stubbed to throw, providerTouched=0); per-row guard (one bad row never aborts the sweep); safeSpine provider-succeeded failure creates a MANUAL_REVIEW reconciliation task; spine-down publish still succeeds and the scan repairs afterwards.
- **Full sweep trail:** APPROVED→QUEUED→EXECUTING→PROVIDER_ACCEPTED→EXTERNALLY_VERIFIED→REPORTED→COMPLETED with external_proofs row action `publish_readback`; transient retry re-queue and AUTH_REQUIRED exhaustion trail asserted event-by-event.
- **Live staging proof:** PENDING — runs after PR #23 merges and Railway deploys (Addendum D+I, run key prompt009-live-1, South Dixie Storage Page 140006069194366).

## 2026-08-01 — Prompt 016: Google data pull proof (staging)

- **Suite:** server **1071/1071** = 1035 + 16 (externalProofs) + 10 (stripeStagingProof) + 10 (`EchoAI/tests/googleStagingProof.test.js`). Single-file: `cd EchoAI && node --require ./tests/dbGuard.js --test tests/googleStagingProof.test.js`.
- **Deployed preflight** (`GET /api/staging-proof/google-preflight` on `5ff21e4`): grant connected, refresh token present, services analytics.readonly/adwords/business.manage/userinfo.email/webmasters.readonly/calendar.events; businessProfile reachable:false with Google's own quota-exceeded text (honest); analytics reachable:true property `properties/473906255` hasData:true.
- **Live evidence (`prompt016-live-1`):** external_proofs row `ec3835c3-dd4c-4a9b-a56c-7f53766aaee4` provider google / action analytics_pull / external_id `properties/473906255` — 9 sessions, 19 pageviews, bounce 0.111 (30daysAgo→today), top sources google 5 / (direct) 2 / bing 1 / lm.facebook.com 1. Verified via read-only `$STAGING_DATABASE_URL`; credential regex scan (ya29|Bearer |access_token|refresh_token) = clean; idempotent re-run created:false, row count still 1.
- **In-app screenshot:** `test_evidence/prompt016/analytics-in-app.png` — staging dashboard Google & SEO → Google Analytics tab rendering the same 9/19/11.1% + source table.
- **Read-only proof:** diff contains no Google write call; proof path = GA4 Admin accountSummaries GET + Data runReport (read-only report queries) via `googleController.fetchAnalyticsSummary`.

## 2026-08-01 — Prompt 007: Stripe test-mode checkout round trip (staging)

- **Suite:** server **1061/1061** = 1035 (pre-006 baseline) + 16 (externalProofs) + 10 (`EchoAI/tests/stripeStagingProof.test.js`); client build green. Single-file: `cd EchoAI && node --require ./tests/dbGuard.js --test tests/stripeStagingProof.test.js`.
- **Genuine forged-signature rejection:** POST staging `/api/subscriptions/webhook` with fabricated `Stripe-Signature` → 400 "No signatures found matching the expected signature" (previously 400 from missing key — not accepted).
- **Deployed preflight:** `GET /api/staging-proof/stripe-preflight` on `bfbc4d9`: secret+publishable keys test-mode, webhookSecret present/looksValid, `starterPriceMatchesEnv:true` (`price_1TvKgc4bVsLTHBIim45VzLqc` = $197/mo, livemode:false), one enabled test-mode webhook endpoint.
- **Live evidence (`prompt007-live-1`):** external_proofs rows customer `cus_UzfN5V9KWPToJe`, subscription `sub_1TzgFU4bVsLTHBIigpP8YT1X` (invoice `in_1TzgFU4bVsLTHBIizlj8CE4M`, amountPaid 19700, PI succeeded), webhook_event `evt_1TzgFX4bVsLTHBIia10C99B1` (invoice.payment_succeeded) incl. resulting tenant subscriptions row starter/active. Verified via read-only `$STAGING_DATABASE_URL`; regex credential scan (sk_/rk_/whsec_/pk_live) = 0 hits; all livemode:false.

## 2026-07-31 — Prompt 006: external_proofs substrate + staging live proof

| Check | Result | Evidence |
|---|---|---|
| Server suite | PASS — **1051/1051** (baseline 1035 + 16 new) | `npm test` in `EchoAI/` (node --test) |
| New suite `tests/externalProofs.test.js` | 16 tests: redaction (key + value patterns, persisted-row check, Graph paging-URL `access_token` regression), rows only from provider responses (missing evidence throws; failed email send ⇒ 502 + zero rows; unpublished post ⇒ 409 + zero rows), `(run_key,provider,action)` dup returns existing row, proof-post claim atomic get-or-create (one row across retries), run-key binding 409, cross-brand run-key 409, immutability trigger rejects UPDATE/DELETE, preflight read-only (zero proof rows, GET-only provider calls), env guard 403s outside staging | test file + suite output |
| Migration 130 | Applied to dev + test DBs (`+ applied 130_external_proofs.sql`) and to staging via deploy `d12f1ec` | migration runner output; staging preflight 200 |
| Architect review | 2 critical findings (double-post window in proof-row-inferred resume; FKs on immutable table block account deletion) — both fixed + regression tests, suite re-run green | review transcript in session |
| Owner merge conditions | (1) staging-only structural env guard before auth + admin gate — regression-tested; (2) paging-URL token redaction regression test; (3) append-only via trigger `trg_external_proofs_immutable`, deletion path deferred to Prompt 029 | Stage-2 preflight report in session |
| Item-9 read-only preflight | PASS — `readOnly:true`, environment `staging`, Page `South Dixie Storage` `140006069194366` read via Graph GET, token present, SMTP `smtp.resend.com` / `Zorecho <no-reply@zorecho.com>`, `existingProofs: []` | CLI output in session (2026-07-31) |
| Live run `prompt006-live-1` | PASS — post `140006069194366_122254631924056707` published with item-14 text → read-back (permalink `facebook.com/122254631936056707/posts/122254631924056707`) → deleted (`success:true`); email messageId `<20b86a89-e364-5000-c27e-16069a064861@zorecho.com>` to jamesrblacketer71@gmail.com | CLI output (server-redacted provider responses) in session |
| Evidence rows | 4 rows in staging `external_proofs` (publish/readback/delete/send), each `environment='staging'`, verified credential-clean (regex sweep for EAA/re\_/Bearer/access_token= patterns — all false) | read-only `$STAGING_DATABASE_URL` queries, 2026-07-31 |

## 2026-07-30 — Prompt 015 code phase (dev environment)

| Check | Result | Evidence |
|---|---|---|
| Server suite | PASS — **1035/1035** (baseline 1014 + 21 new) | `npm test` in `EchoAI/` (node --test) |
| New suite `tests/spendCapControls.test.js` | 21 tests: deny-by-default (no brand cap / no platform row / brand SUM / platform SUM), term-6 pending sums, denial = audit row + ZERO Graph calls, atomic compensation (order ad→adset→campaign, PAUSED re-pause bodies, marker NULL), idempotent no-ops (no Graph, no audit), pause campaign-first + marker clear (incl. partial-failure regression pair), refresh recognition-only (zero POSTs), tenant isolation 404s, launch-path ACTIVE grep-proof, money round-trips incl. NUMERIC strings | test file + suite output |
| Client suite / build | PASS — 385/385; vite build green (sw v158 in dist) | `npm test` in client; `npm run build:client` |
| Migration 129 | Applied to dev (`+ applied 129_ad_spend_caps.sql`, platform row = 2500¢ verified) and test DB (pretest runner) | migration runner output + psql check |
| Architect review | 1 critical finding (stale pending marker on partial pause) — fixed, 2 regression tests added, suite re-run green | review transcript in session |
| Staging denial proof | **PASS** (2026-07-30, owner steps) — PR #19 merged, deploy SHA `b19c8de` verified via `/api/health` ×3; migration 129 seeded platform row 2500¢, zero brand caps; Enable clicked with no cap ⇒ red denial copy "No daily spending cap is set for this business. Set a cap first — unpausing is impossible without one." (owner screenshots, incl. stale-PWA v157→v158 refresh cycle first); audit row `6ad5ae59…` on campaign `626851f3…`: `unpause/denied`, brand cap NULL, platform 2500¢, budget 500¢, committed 0¢; ZERO Graph calls, all 3 rows still `created_paused`, marker NULL; NO real unpause-to-spend (D-7) | owner screenshots (attached_assets 2026-07-30) + read-only staging DB queries |

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
| Staging external proof (Ads Manager paused chain screenshot, delete chain, zero spend) | PASS — post-merge (`aa5cd2f`) launch via normal manual path: full chain `120249543035500774`→`120249543037900774`→`1360358236206552`→`120249543046340774`; trail APPROVED→…→COMPLETED (task `49f877d2`); `launch_readback` proof row PAUSED at all levels; Activity screenshots captured pre-deletion; Ads Manager Off/$0 ("Do you want to delete 4 campaigns?" → "No results found", 018 chain + 3 pre-existing Marketplace drafts removed); $0 spend throughout | agent DB captures + owner Ads Manager screenshots (attached_assets/image_1785758328416/403029/497988.png), 2026-08-03 |

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
