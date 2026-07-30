# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-07-30, during REPLIT_PROMPT_015 (spending caps + pause/unpause, Stage-2 authorization D-22 with ten binding owner terms). Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_005 v2: **COMPLETE** — evidence-only closeout accepted 2026-07-30 (consumer inventory re-derived from staging tip `cc94b78`; canonical sets in `utils/campaignState.js`; zero reserved-edge writers; PR #17/#18 deployed).
- REPLIT_PROMPT_015: **code phase COMPLETE locally** (2026-07-30). Server **1035/1035** (baseline 1014 + 21 new in `tests/spendCapControls.test.js`), client **385/385**, build green, migration `129_ad_spend_caps.sql` applied to dev + test DBs (platform $25/day row seeded), PWA shell cache v157→v158, dist rebuilt. Architect review round done — 1 critical finding FIXED: partial pause failure where the campaign object DID pause now clears `activation_requested_at` (else stale marker inflates committed sums and traps unpause in its already-pending no-op); two regression tests added.
- **Pending:** branch `prompt-015-spend-caps` off staging tip `cc94b78` + PR into `staging` (git-plumbing recipe, never `git branch/tag`); owner merge → Railway deploy → migration 129 seeds the platform cap; staging denial proof (unpause without brand cap ⇒ denial screenshot + `ad_spend_audit` `result='denied'` row, read-only via `$STAGING_DATABASE_URL`). **NO real unpause-to-spend** (D-7 — first real spend is Phase H on own businesses).

## What Prompt 015 built (binding owner terms D-22)

- **Caps as data:** `ad_spend_caps` — one row per brand + exactly one `brand_id IS NULL` platform row ($25/day pilot, seeded by migration; changing it is an UPDATE, never a deploy). Partial unique indexes enforce one-per-brand / one-platform-row.
- **Deny-by-default (`utils/spendCaps.js#evaluateUnpause`):** order = no budget → no brand cap ("no cap, no unpause") → missing platform row → brand SUM (committed + candidate > cap) → platform SUM (excludes is_demo). Committed = `live` + `created_paused AND activation_requested_at IS NOT NULL` (term 6). Display-layer `spendLimits.getBrandSpend` stays live-only BY DESIGN — do not "fix".
- **Money units (term 8):** `campaigns.budget` = DOLLARS NUMERIC (pg returns strings); caps + audit + Graph `daily_budget` = CENTS. `dollarsToCents` handles NUMERIC strings, rejects garbage/negative; round-trips tested.
- **Atomicity (term 10):** unpause activates ad → ad set → campaign LAST; any failure ⇒ compensating re-pause of already-activated objects (reverse order), audit `result='failed'`, owner push alert, marker untouched. Pause is campaign-FIRST.
- **Honest states (terms 5/7/9):** audit `result='success'` = Facebook ACCEPTED, never "live". `activation_requested_at` set only after acceptance (guarded WHERE status='created_paused'); cleared on verified live (via 005 read-back), on pause (including partial pause where the campaign object paused), and on definitive failure. UI shows blue "Activation pending — Facebook accepted, not verified live yet" distinct from the amber paused badge.
- **Idempotency:** per-campaign session advisory lock (`pg_advisory_lock(hashtextextended(id,15))` on a dedicated pool client, unlock in finally); already-live/already-pending unpause and already-paused pause are no-ops with zero Graph calls and zero audit rows; exactly one audit row per state-changing attempt; denials write audit + make ZERO Graph calls.
- **Recognition-only refresh:** POST `/:id/refresh-status` invokes the existing 005 `verifyCampaignStatus` (GET-only), clears the marker on verified live.
- **Untouched:** launch paths still PAUSED-only (grep-proof test); `verifyCampaignStatus` remains the SOLE writer of `live`/`created_paused`; launch_failed retry NOT built (term 3, future I-24).
- **Surface:** routes owner-only via `requireOwner` on `/api/campaigns/spend-cap` (GET/PUT) + `/:campaignId/pause|unpause|refresh-status|audit`; `getCampaignPerformance` (BOTH selects — two-endpoint trap) now returns `activationPending` + `lastVerifiedAt`; client `Campaigns.jsx` cap editor + Enable/Pause/Refresh buttons, denial copy surfaced inline, first-load-only spinner guard.

## Standing credential (I-25)

- Fine-grained PAT scoped to `19JRB71/EchoAI-Foundation` (Contents + Pull requests R/W), stored in `GITHUB_PUSH_TOKEN`, **expires 2026-10-28**. Scope table, rotation checklist, and API revocation recipe in `DEPLOY_CREDENTIALS.md` (workspace root). Old Prompt-004 PAT revoked via API (verified dead 401).

## Environment notes

- Dev server localhost:8080; dev JWT: jsonwebtoken `{userId}` + `JWT_SECRET||SESSION_SECRET`. Staging health `https://staging.zorecho.com/api/health` → version = deploy SHA (currently `cc94b78`). Staging campaigns: 3 created_paused + 7 launch_failed, zero live, zero brand caps.
- Push recipe: fetch token-URL → temp GIT_INDEX_FILE → read-tree FETCH_HEAD → add explicit paths → write-tree → commit-tree → push SHA to new ref; PR via API with `$GITHUB_PUSH_TOKEN`. NEVER `git branch/tag` from the shell (leaves lockfiles that break the owner's Git panel).

## Standing rules (unchanged)

End-of-Prompt reports per GLOBAL_PROMPT_RULES; keep the five continuity docs + `.local/.commit_message` updated; one owner step at a time with exact click/see instructions; stop-and-wait; checkpoint SHA lags one message; **STOP AND REPORT** if any new conflict changes D-22, the state machine, cap enforcement, pending-activation handling, launch-path safety, or actual-spend risk.
