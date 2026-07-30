# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-07-30, during REPLIT_PROMPT_005 v2 (+ owner addendum v3, binding). Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_005 v2 (honest campaign lifecycle with Facebook read-back verification): **code phase COMPLETE locally** (2026-07-30). Server **1014/1014** (baseline 998 + 16 new in `tests/campaignStateMachine.test.js`), client **385/385**, build green, migration `128_campaign_state_machine.sql` applied to dev + test DBs (dev: 9 `active` → 9 `created_paused`). Architect review round done (2 findings fixed: `runWeeklyAnalytics` brand discovery still on `'active'`; admin `adSpendManaged` now `live`-only).
- **Pending:** branch + PR into `staging` off tip `a65e2f5` (waiting on owner: GitHub PAT status — the Prompt 004 temp PAT was to be deleted; a fresh fine-grained PAT is needed for the push), then staging deploy, then the SDS2 external proof (launch ends `created_paused`, UI copy shown, Ads Manager matches, delete chain, record deletion response, zero spend).
- Prior: REPLIT_PROMPT_004 v3 **COMPLETE** (PR #16, deployed `a65e2f5`, live-verified on SDS2, `FACEBOOK_LINK_URL` removed from Railway).

## What Prompt 005 changed (summary)

- Legal states: `draft, approved, created_paused, live, completed, failed, launch_failed`. Launches insert `created_paused`. No writers exist for `completed`/`failed` (future prompts).
- `utils/campaignState.js` — the single state machine. Every domain-state change goes through `transitionCampaignStatus` (guarded UPDATE, row-count branch, illegal transitions throw). `created_paused⇔live` requires a private authority token held ONLY by the verification helper.
- `utils/campaignVerification.js` — `verifyCampaignStatus(campaignId)`, the Single Verification Authority: GET-only Graph read-back (campaign + ad set + EVERY ad must have `status`==ACTIVE AND `effective_status`==ACTIVE; zero ads ≠ live). Failed read-back: state unchanged + `last_verify_error`. Success: `last_verified_at` stamped, error cleared, honest flips both directions. Token comes from the campaign row's OWN user (tenant isolation).
- Owner ruling (2026-07-30, recorded): Autonomous Growth must NEVER write `campaigns.status` directly. Its legacy `paused` writer was removed; the engine is scoped to `live` rows (correctly dormant until Prompt 015 ships unpause); after its provider-side FB pause it calls the verification helper best-effort.
- Committed spend counts ONLY `live`: `spendLimits.getBrandSpend`, `adminController` platform stats (`campaignsRunning`, `adSpendManaged`), AG `monthToDateSpend`. NO budget-reservation feature (addendum G).
- Presence consumers moved to `IN ('created_paused','live')`; `dataQualitySentry` analytics-coverage sweep deliberately narrowed to `live`.
- UI: Campaigns `StatusPill` — `created_paused` shows **"Created (paused at Facebook — will not spend until enabled)"** (amber); `live` green only after verification; `launch_failed` red. PWA shell cache v156→v157; dist rebuilt.
- Recognition-only proven: diff adds zero mutating Graph calls (grep-proof in the report). Unpause is Prompt 015's alone.

## Next steps (in order)

1. Owner: confirm Prompt 004 temp PAT deleted; provide a fresh fine-grained PAT (`GITHUB_PUSH_TOKEN` secret) for the Prompt 005 push.
2. Verify migration slot 128 still free on the live `staging` tip at push time; branch `prompt-005-campaign-states` off current staging tip (`a65e2f5` as of 2026-07-30) via the git-plumbing recipe (never `git branch/tag` from the shell); PR into `staging`; owner merges.
3. Staging external proof on SDS2 per addendum H; then final End-of-Prompt report + doc updates to COMPLETE.

## Continuity items

- `launch_failed → approved` (explicit retry) and `approved → created_paused` are legal in the machine but NO retry endpoint exists yet — a future prompt may add it, reusing the Prompt 003 duplicate-ad guard.
- Prompt 015 (unpause) must use `verifyCampaignStatus` for the `live` flip — never a direct write; the authority token stays private to `utils/campaignVerification.js`.
- Demo seeder rows now default to `created_paused` (column default changed in 128).
- I-22 recommendation stands (Ad Creative Studio still assembles its own chain — consolidation candidate).
