# COMPLETED_WORK.md — Zorecho Completed Work Log

**Last updated:** 2026-07-26. Append-only; newest first. Milestone-level history predating this file lives in `MILESTONES.md` (authoritative for Sage V2 phases 1–6 and Collab Stage 0).

## 2026-07-27 — REPLIT_PROMPT_003 v2: Facebook ad object in both launch paths — code phase COMPLETE (staging proof pending)

- **Gap reproduced:** grep-proven zero `/ads` POSTs anywhere; both paths stopped after the creative; `campaignController` silently skipped the creative when Page/link env was missing (undeliverable chain reported as success); mid-chain Graph failures orphaned FB objects with no local record.
- **Fix:** shared `utils/facebookApi.createPausedAd` — the ONLY `/ads` POST in the codebase, hardcodes + asserts `status:"PAUSED"`. Chain in both `campaignController.launchFacebookCampaign` (manual + Autopilot + setup/companion callers) and `adCreativeStudioController.launchCreative`: campaign → ad set → creative → ad, all PAUSED, four ids logged per launch.
- **Owner safeguards implemented:** (1) duplicate-ad guard — `findExistingAdId` checked before every `/ads` POST; (2) `facebook_ad_id` persisted only after FB returns the id; (3) partial chains never silent — `utils/facebookLaunchSafety.recordFailedLaunch` writes a `launch_failed` campaigns row with all known ids (also when the LOCAL insert fails after FB success), logs, and API errors carry `partialChain`; (4) single launch path — Autopilot approve routes through the same `launchFacebookCampaign` (asserted by test).
- **Fail-fast guard:** missing Page (`page_ref` || env) or `FACEBOOK_LINK_URL` now 503s BEFORE any FB object is created (mirrors the studio guard; previously campaign+adset were created undeliverable).
- **Migration:** `EchoAI/models/126_facebook_ad_object.sql` — additive `campaigns.facebook_creative_id`, `campaigns.facebook_ad_id`.
- **Tests:** `EchoAI/tests/facebookAdObject.test.js` (8) — mocked-Graph four-POST linkage + PAUSED on both paths, fail-fast (0 Graph calls), partial-failure recording/surfacing (both paths + manual API body), duplicate guard, tenant isolation (per-user token), single-path assertion. Architect review round done; all blocking findings fixed. Suite 985 + 8 = **993/993**.
- **Pending:** staging external proof (launch → Ads Manager screenshot of paused campaign→ad set→ad → delete chain, deletion responses recorded, zero spend) — owner steps.

## 2026-07-27 — REPLIT_PROMPT_002 v2: Facebook staging connect end-to-end — COMPLETE

- **Configuration + live verification only; zero code changes, zero migrations** (all five FB columns already existed in staging; scopes incl. ads_management already requested with auth_type=rerequest).
- Preflight: staging redeployed at SHA `62ea1fc` (contains all accepted Phase A commits, ancestry-verified); Meta app `1747619749738868` matches Railway `FACEBOOK_APP_ID`; `FACEBOOK_REDIRECT_URI` override = `https://staging.zorecho.com/api/facebook/oauth/callback` = Meta Valid OAuth Redirect URI (Strict Mode + Enforce HTTPS on).
- Assets reused (owner decision, own-business testing): South Dixie Storage account, SDS2 ad account (`act_818682…`), South Dixie Storage Page. Integration row `23c39a73-8486-49a1-b734-3979c1516527`, user-scoped as designed.
- Evidence: connected card screenshot (SDS2 · USD · Active); wizard verify step all 4 probes GREEN (ad account, Page, ads_management, pixel) before AND after reconnect; revoke in FB Business Integrations then reconnect — proven by row `updated_at` 2026-07-24 17:44 → 2026-07-27 14:57 UTC with same account_ref/page_ref and refreshed encrypted tokens.
- Lesson: on reconnect Facebook re-applies the prior asset grant (only new choices shown); granted-pages snapshot collapsed 19 → 1 (exactly the selected Page) — selected refs survived.
- Consent-screen screenshot: not captured (owner-attested; DB round-trip proof stands in). Marked UNVERIFIED in the evidence pack.

## 2026-07-26 — REPLIT_PROMPT_008 v2: Honestly disable legacy-FCM mobile push — COMPLETE

- Preflight reproduced the gap: `config/fcm.js:14` targets Google's retired `fcm.googleapis.com/fcm/send`; with `FCM_SERVER_KEY` set, sends would hit it and count failures silently. One caller chain (`sendToTokens` ← `mobilePushController.sendToUser` ← 14 best-effort alert sites). No web-UI mention of mobile push (web push is a separate working system — untouched).
- `config/fcm.js`: hard disable behind `FCM_LEGACY_ENABLED` (default OFF = disabled); ONE boot warning when a server key is present; `sendToTokens` no-ops with `{skipped:true, reason:'legacy_endpoint_disabled'}` before any network path; exports `disabledReason`.
- `mobilePushController`: token registration retained (zero-effort, ready for post-GA HTTP v1); register response is honest — "Device registered. Mobile push is not available yet." + `mobilePushAvailable:false`; `sendToUser` propagates the reason.
- `tests/mobilePushDisabled.test.js` (3 tests): fetch tripwire proves the endpoint is unreachable even with a server key set.
- Suite 982 → 985/985 green. Architect review PASS (verified no alternate send path; all callers best-effort-safe).
- Rollback: `FCM_LEGACY_ENABLED=true` (emergency only — re-opens retired-endpoint behavior).

## 2026-07-26 — REPLIT_PROMPT_014: Tenant-isolation regression suite — COMPLETE

- New dedicated suite (20 tests, tests-only change): `EchoAI/tests/tenantIsolation.core.test.js` (10), `tenantIsolation.surfaces.test.js` (6), `tenantIsolation.background.test.js` (4).
- Coverage: two-tenant direct-id probing (brands, campaigns, leads, social_posts, ad_creatives, email campaigns/recipients, setup sessions, Sage endpoints; integrations & guided progress proven user-scoped with no foreign-id input path); team-member remap correctness (viewer reads owner's data, blocked from admin routes and mutations); background is_demo gating (`publishDuePosts`, `runDailyGoalTracking`); Sage single-brand delivery (`runUrgentScanForBrand(X)` writes scoped to X only).
- All four historical bug classes encoded: (1) client active-brand copies — the isolation control is server-side denial of any foreign brand-id, whatever the client sends (core/surfaces probes; the team-member remap test additionally proves a remapped user's own stale brand-id cannot cross workspaces); the original App.jsx bug was within-tenant display staleness, not cross-tenant access, so no client test is required for isolation. (2) Sage single-brand delivery (background test #3). (3) background paths bypassing route gates — BOTH halves: is_demo exclusion (tests #1-2) AND tier gating (test #4: `maybeStartSequenceForLead` enforces the Pro gate internally at `followUpController.js:737`; Starter brand gets zero sequences, Pro brand gets one). (4) is_demo bleed (tests #1-2).
- **Defects found: NONE** — every probe returned 403/404 with no data leakage; body-content secret-marker checks + DB re-reads confirm no unauthorized reads or writes. No application code changed.
- Server suite 962 → 982/982 green. Architect review PASS.

## 2026-07-25 — REPLIT_PROMPT_012: Backup & Baseline — COMPLETE

- `ROLLBACK.md` created: backup/restore/rollback procedure + restore-drill evidence.
- Restore drill executed on the Replit dev database: `pg_dump -Fc` (3,134,559 bytes) → `pg_restore` into scratch DB, 0 errors; app migration runner reported `0 applied, 130 skipped`; sanity counts identical to source. Scratch DB dropped.
- GitHub baseline (created by James, confirmed via screenshots): branch `backup/pre-turnaround` from `main`; tag `pre-turnaround-baseline` via published release targeting `main`.
- Railway manual volume backups (created by James): production 2026-07-25 22:56 UTC, 940 MB (service **Postgres**); staging 22:58 UTC, 885 MB (service **Postgres-v9JE**).
- Incident fixed: stale `.git/refs/tags/pre-turnaround-baseline.lock` (left by a blocked agent-side tag attempt) broke the Git panel with INDEX_LOCKED; removed, push succeeded.
- Follow-ups recorded (operational, non-blocking): staging-backup restore drill, enable PITR, set backup schedules.

## 2026-07-24/25 — Full System Review Package

- `ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24.zip` (3.4 MB, 946 files): 21 documentation files + sanitized source tree, secret-scanned, for outside architect review. Baseline commit `ae50e8a6`.

## Earlier (see MILESTONES.md for full detail)

- Sage V2 Phases 1–6: all approved (July 17–19, 2026). Sage V2 feature complete.
- Department Collaboration: architecture approved; Stage 0 built dark and completed July 19, 2026 (925 server / 372 client tests, architect review PASS).
