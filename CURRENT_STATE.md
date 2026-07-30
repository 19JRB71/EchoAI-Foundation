# CURRENT_STATE.md — Zorecho Project State

**Last updated:** 2026-07-30 (REPLIT_PROMPT_005 v2 + owner addendum v3 — code phase COMPLETE locally: honest campaign lifecycle/state machine, 1014/1014 server + 385/385 client, migration 128 applied to dev+test DBs; awaiting push/PR + staging external proof. Prior: REPLIT_PROMPT_004 v3 — COMPLETE: per-brand Facebook Page + destination link, D-20 Option C; merged to `staging` via PR #16, deployed at `a65e2f5`, live-verified on SDS2, `FACEBOOK_LINK_URL` removed from Railway staging)
**Maintained by:** Lead Software Engineer (Replit agent). Update at the close of every prompt.

## Snapshot

- **Product:** Zorecho (internal name EchoAI) — AI-powered SaaS marketing platform, ~30 subsystems. See `replit.md` and `EchoAI/README.md`.
- **Sage V2:** feature complete — bug fixes only (CEO directive, July 19, 2026).
- **Department Collaboration:** Stage 0 built dark and approved; all `COLLAB_*` flags OFF. Stage 1 awaits explicit CEO go-ahead.
- **Governing documents:** `ZORECHO_OPERATIONAL_ROADMAP.md` (execution order), `ENGINEERING_CONSTITUTION.md`, `CUSTOMER_EXPERIENCE_CONSTITUTION.md`.
- **Deployment:** Railway from GitHub `main` (production: app.zorecho.com; staging: staging.zorecho.com). James pushes via the Replit Git panel; the agent cannot push.

## Baseline (locked 2026-07-25, Prompt 012)

- Git tag `pre-turnaround-baseline` — published on GitHub (release "Pre-turnaround baseline (2026-07-25)", target `main`).
- Branch `backup/pre-turnaround` — created on GitHub from `main`.
- Railway backups: production 2026-07-25 22:56 UTC (940 MB), staging 22:58 UTC (885 MB). Details: `ROLLBACK.md` §2.
- Restore drill: performed against the Replit dev database (full evidence in `ROLLBACK.md` §3). A drill against a real Railway staging backup is an **operational follow-up, not a blocker** — the roadmap does not require it before the next prompt.

## Test state (last verified 2026-07-25, Replit dev environment)

- Server suite: 993/993 passing (2026-07-27, `/tmp/prompt003_full_run.log`).
- Facebook launches (Prompt 003): both paths now create the full PAUSED chain campaign→ad set→creative→**ad** and persist all four ids; partial chains recorded as `campaigns.status='launch_failed'` and surfaced (`partialChain`); duplicate-ad guard; missing Page/link fails fast with 503 before any FB object (previous silent-skip behavior removed). Staging external proof COMPLETE (2026-07-29): full PAUSED chain created on SDS2 via Ad Creative Studio, verified Off/$0 in Ads Manager (screenshots), all 6 test campaigns (1 complete + 5 partial from iteration) deleted, zero spend. Mid-2026 Facebook Graph API now requires on create: campaign `is_adset_budget_sharing_enabled:false`; ad set `bid_strategy:"LOWEST_COST_WITHOUT_CAP"`, `targeting_automation.advantage_audience:0`, `promoted_object:{page_id}` — all added to both launch paths (PRs #11–#14). Graph errors now surface `error_user_title/error_user_msg` + code/subcode (PR #10). The Meta app must be **published/Live** (dev-mode creatives can't create ads) and staging needs `FACEBOOK_LINK_URL` set — both done. Staging tip: `1389e7a`.
- Per-brand ad destination (Prompt 004, D-20 Option C): launches resolve the Facebook Page + link from `brands.facebook_page_id` / `brands.ad_link_url` (migration `127_brand_ad_destination.sql`, behavior-preserving backfill from `page_ref`/`website_url`). Zero env-var reads (`FACEBOOK_PAGE_ID`/`FACEBOOK_LINK_URL`) and zero `page_ref` reads in launch paths — `page_ref` is only a wizard default suggestion. Launch validates the brand's Page is still in the granted list (`api_integrations.facebook_pages`); revoked ⇒ honest 503 reconnect guidance. Gating (Echo companion + Setup Agent) now gates on brand columns + live connection. Wizard Page selection persists per brand; brand settings gained an "Ad destination link" field (`adLinkUrl`, validated). Server suite 994→998/998; client 385/385; build green. Merged (PR #16, staging tip `a65e2f5`) and live-verified 2026-07-29: unconfigured brand → honest 503 with zero FB objects; configured brand → full PAUSED chain from brand data with `FACEBOOK_LINK_URL` deleted from Railway; chain deleted in Ads Manager, zero spend.
- Mobile push (legacy FCM): **honestly disabled** (Decision D-12, Prompt 008) — retired endpoint unreachable; sends no-op with `reason: 'legacy_endpoint_disabled'`; token registration retained; re-enable only via `FCM_LEGACY_ENABLED=true` (emergency rollback only). Web push unaffected. Client suite: 385/385 passing. Client production build: green.
- Evidence index: `TEST_EVIDENCE_INDEX.md`.

## Open operational follow-ups (not blockers)

1. Restore drill against a real Railway staging backup (needs the staging DB public URL in Secrets).
2. Enable PITR on both Railway Postgres services (currently OFF).
3. Set a backup schedule on both Railway Postgres services (currently none).

## Prompt series status

- REPLIT_PROMPT_012 (Backup & Baseline): **COMPLETE** (2026-07-25).
- REPLIT_PROMPT_013 (test-env bootstrap & suite hygiene): **COMPLETE** (2026-07-25) — clean checkout now runs `npm test` green with zero secrets configured (test-only dummy defaults in the guarded preload); ordering-sensitive failure root-caused (env dependency, not cross-file leak) and gone; suite 962/962 both with and without env vars. Evidence in `TEST_EVIDENCE_INDEX.md`.
- REPLIT_PROMPT_002 v2 (Facebook staging connect + Page + ad-account selection): **COMPLETE** (2026-07-27) — live verification only, ZERO code changes. Staging (deployed SHA 62ea1fc, contains all Phase A) connected via South Dixie Storage (owner decision): SDS2 ad account `act_8186…`, South Dixie Storage Page, all 4 live probes green pre- AND post-reconnect; revoke-and-reconnect proven by integration-row timestamp advance (07-24 17:44 → 07-27 14:57 UTC) with page_ref/account_ref intact. Consent-screen screenshot: owner-attested (not captured). Unblocks 003/004/006/016.
- REPLIT_PROMPT_008 v2 (disable legacy-FCM mobile push): **COMPLETE** (2026-07-26) — `config/fcm.js` hard-disabled behind `FCM_LEGACY_ENABLED` (default off), one boot warning, `sendToTokens`/`sendToUser` no-op with `reason:'legacy_endpoint_disabled'`; register API says "Mobile push is not available yet"; no web-UI surface mentions mobile push (grep-proven); 3 new tests incl. fetch tripwire; suite 985/985. Web push untouched.
- REPLIT_PROMPT_014 (tenant-isolation regression suite): **COMPLETE** (2026-07-26) — three new suites `EchoAI/tests/tenantIsolation.{core,surfaces,background}.test.js` (20 tests) cover direct-id probing on brands/campaigns/leads/social_posts/ad_creatives/email/integrations/setup sessions/guided progress, team-member remap (viewer can't admin), background is_demo gating (publishDuePosts, runDailyGoalTracking), background tier-gating (maybeStartSequenceForLead enforces the Pro gate itself on the sweep path), and Sage single-brand delivery. **Defects found: NONE** — verification outcome, zero application-code changes. Server suite 982/982.
- REPLIT_PROMPT_001 v2 (token encryption + Stripe webhook signatures): **COMPLETE** (2026-07-25) — verification-only outcome (no code gaps found); 11 new security tests green (server suite 962/962); staging SQL ciphertext check PASSED (all 4 token columns show ciphertext, evidence in `TEST_EVIDENCE_INDEX.md`). Bonus: `STAGING_DATABASE_URL` secret now available for the restore-drill follow-up.
