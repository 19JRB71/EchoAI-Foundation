# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-07-27, during REPLIT_PROMPT_003 v2. Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_003 v2 (Facebook ad object in both launch paths): **COMPLETE** (2026-07-29 — staging external proof done).
  - **Staging proof (2026-07-29):** full PAUSED chain created on SDS2 via Ad Creative Studio ("Pole Barn Kits - Tipping Point", $5/day): campaign `120249420223810774`, ad set `120249420224360774`, creative `1408353584447141`, ad `120249420227100774`. Verified Off/$0 in Ads Manager (owner screenshots). All 6 test campaigns (1 complete + 5 partial from the iteration) deleted via Ads Manager bulk delete ("6 campaigns were deleted" confirmation captured); zero spend throughout.
  - **Mid-2026 Facebook Graph API changes discovered & fixed (5 follow-up PRs into `staging`, each 993/993):** PR #10 surface `error_user_title/error_user_msg`+code/subcode in Graph errors (`utils/facebookApi.js`); PR #11 campaign create requires `is_adset_budget_sharing_enabled:false` (subcode 4834011); PR #12 ad set requires explicit `bid_strategy:"LOWEST_COST_WITHOUT_CAP"` (2490487); PR #13 targeting requires `targeting_automation.advantage_audience:0` (1870227); PR #14 ad set requires `promoted_object:{page_id}` (1885154). Both launch paths patched. Staging tip after PR #14: `1389e7a`.
  - **Environment prerequisites established:** `FACEBOOK_LINK_URL=https://staging.zorecho.com` set on Railway staging (prolific-perception); the Meta app was **published to Live** by the owner (dev-mode apps cannot create ads from their creatives, subcode 1885183) — production launches need both.
  - Temp fine-grained GitHub PAT used for the 5 surgical branch pushes; owner to delete the token + the `GITHUB_PUSH_TOKEN` secret (same cleanup as the Prompt 003 deploy).
  - Shared `createPausedAd` (only `/ads` POST, PAUSED asserted); fail-fast Page/link guard; duplicate-ad guard; `facebook_ad_id` persisted only after FB returns it; partial chains recorded (`launch_failed` + partial ids) and surfaced via `partialChain`; four ids logged per launch; Autopilot shares the single launcher (test-asserted).
  - Migration `EchoAI/models/126_facebook_ad_object.sql` (additive). Tests +8 (`tests/facebookAdObject.test.js`); suite **993/993** (`/tmp/prompt003_full_run.log`). Architect review round done, blocking findings fixed.
  - Remaining: owner merges to `staging`, then one live launch on staging → Ads Manager screenshot of the paused campaign→ad set→ad chain → delete the chain (record deletion responses) → confirm zero spend.
  - **Deployment correction applied (CEO, 2026-07-27):** migration renamed `125_facebook_ad_object.sql` → `126_facebook_ad_object.sql` (staging already has Prompt 010's `125_job_runs.sql`; 126 verified unused on the live `staging` branch, tip `6799def`). Deploy via a dedicated Prompt 003 branch into `staging` — never a main→staging PR; leave `main` untouched; no force pushes.
  - **Continuity item for Prompt 005:** the new `campaigns.status = 'launch_failed'` value must be incorporated into Prompt 005's campaign-state migration and consumer inventory (any query filtering by campaign status must decide how to treat `launch_failed` rows).
  - Behavior change to know: `launchFacebookCampaign` now 503s when no Page/link instead of silently creating an undeliverable campaign+adset (affects setup agent / echo companion fallback paths — honest failure, step recorded skipped, never blocks setup).
- REPLIT_PROMPT_002 v2 (Facebook staging connect + Page + ad-account selection): **COMPLETE** (2026-07-27).
  - Live staging verification only — **zero code changes, zero migrations**. Staging deployed at SHA `62ea1fc` (contains all accepted Phase A).
  - Connected via South Dixie Storage (owner decision D — own-business testing): SDS2 ad account (`act_8186…`), South Dixie Storage Page; integration row `23c39a73-8486-49a1-b734-3979c1516527` (user-scoped, by design).
  - All 4 live probes green pre- AND post-reconnect; revoke-and-reconnect proven by row `updated_at` advance (07-24 17:44 → 07-27 14:57 UTC) with refs intact. Consent screenshot: owner-attested only (see TEST_EVIDENCE_INDEX).
  - Lesson recorded: FB re-consent silently re-applies the prior grant; pages snapshot shrank 19→1 (memory: echoai-fb-reconnect-grant).
- Phase A (012, 001, 013, 014, 008): **all COMPLETE and owner-accepted**; merged to `staging` branch and deployed.

## Next prompt to execute

Prompt 002 unblocks **003 (missing FB ad object), 004 (per-brand ad Page/link), 006 (real FB post + email proof), 016 (Google data pull)**. Await the CEO's chosen next prompt text. Note the prompt index also lists 010 (a Task #124 proposal appeared in the project task queue).

## Standing context for the next session

- Read `CURRENT_STATE.md` first, then `ZORECHO_OPERATIONAL_ROADMAP.md` for execution order and the CEO validation cadence.
- Staging deploys from the GitHub `staging` branch (PR main→staging; Railway auto-deploys; verify via `https://staging.zorecho.com/api/health` version field). Agent cannot push/create refs — owner merges via GitHub.
- Staging DB is verifiable read-only via `STAGING_DATABASE_URL` (`SET default_transaction_read_only = on`).
- Evidence rule, End-of-Prompt Report format, commit-hash lag note, rollback line: all still mandatory. `GLOBAL_PROMPT_RULES.md` still not in repo.

## Open follow-ups (operational, non-blocking)

1. Restore drill against a real Railway staging backup (`ROLLBACK.md` §3).
2. Enable PITR on both Railway Postgres services.
3. Set a backup schedule on both Railway Postgres services.
