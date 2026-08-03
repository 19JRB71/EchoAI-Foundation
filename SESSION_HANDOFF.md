# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-08-02, end of REPLIT_PROMPT_018 build (ad-launch task spine — code complete, PR up, awaiting owner merge + staging live proof). Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_018 (D-27): **CODE COMPLETE, PR AWAITING OWNER MERGE.** Branch `prompt-018-ad-launch-spine` off staging tip `b0fbf61`, PR base `staging`. After the owner merges and staging deploys, the **staging live proof is still owed**: launch a PAUSED chain on SDS2 via the normal manual path, capture the full task trail + proof row + screenshots + DB rows BEFORE deleting the chain, $0 spend.
- What landed: `utils/adLaunchSpine.js` — the ONE canonical ad-launch adopter (task_type `ad_launch`, source_type `campaign`, source_id = pre-generated campaigns.campaign_id). Trail: APPROVED→QUEUED→EXECUTING→PROVIDER_ACCEPTED (only with ALL FOUR FB ids)→EXTERNALLY_VERIFIED (Prompt 005 read-back → external_proofs `launch_readback` row, run_key `task-<taskId>`, referenced never copied)→REPORTED→COMPLETED. Failure classes: partial chain always EXTERNAL_FAILURE (partial ids in evidence); pre-chain by cause (AUTH_REQUIRED / PERMISSION_DENIED / RATE_LIMITED / VALIDATION_FAILED / EXTERNAL_FAILURE); provider-success-then-persist-fail = PROVIDER_ACCEPTED then MANUAL_REVIEW `persist_failed` (Addendum F: NEVER relaunch); verify-fail = MANUAL_REVIEW `verification_failed`, no retry.
- Entry points wired: manual createCampaign (origin from allowlisted req.body.origin), Ad Creative Studio (`ad_studio`), Autopilot (`autopilot`), Echo companion (`echo`), Setup Wizard (`setup_wizard`).
- Prompt 015 wiring: campaignControlController.writeAudit RETURNING audit_id → adLaunchSpine.attachLifecycleEvidence attaches pause/unpause/cap events to the SAME terminal launch task (no state change, no new task).
- Reconciliation (taskSpine.scanForMissingTasks): campaigns rows with FB ids and no ad_launch task → reconstructLaunchTrail (bookkeeping only, ZERO provider calls; launch_failed→EXTERNAL_FAILURE; created_paused/live→…→COMPLETED with proof reuse-by-reference or honest `verification:'unavailable'`); stale EXECUTING >30min → MANUAL_REVIEW (`system:stale-rescue`); orphaned launch_readback proofs re-linked.
- State agreement: `AGREEMENT` map in adLaunchSpine; disagreement THROWS in tests (NODE_ENV=test or `__ECHOAI_TEST_DB_URL` marker), MANUAL_REVIEW in prod — never silently reconciled.
- Migration `132_ad_launch_task_type.sql` — additive CHECK widen only (D-19 justified). Applied to test DB and local dev DB (dev was missing 130/131/132 — `task-spine-reconcile` job was erroring "relation agent_tasks does not exist"; fixed by `npm run migrate`).
- Client: ActivityPanel ad_launch-aware status labels (a verified launch reads "Verified at Facebook (paused)" — nothing spends); sw cache v160; dist rebuilt and committed.

## Review round (architect) — findings + dispositions

- FIXED: persist-failure catches now pass the canonical `campaignId` to recordFailedLaunch so failure rows stay joined to the task source id.
- FIXED: recordFailedLaunch's explicit-id fallback now fires ONLY on a true PK collision (23505); other DB errors bubble to the honest log-and-null path.
- FLAGGED (pre-existing, NOT changed — out of 018 scope): autopilotController.approveItem wraps launchFacebookCampaign inside the item-claim transaction; if COMMIT fails after a successful launch, the item stays pending while the campaign exists → a retry could launch a second chain. Recommend a small follow-up prompt (commit the claim before launching, compensate on launch failure) — do not fold silently into other work.

## Test state

- Server suite **1105/1105** (baseline 1090 + 15 `tests/adLaunchSpine.test.js`); client **385/385**; client build clean.
- campaignStateMachine.test.js: three deepStrictEqual assertions updated for the additive `readBack` payload on verifyCampaignStatus (verdict fields unchanged).
- Test gotchas recorded: external_proofs is append-only ACROSS runs — test-inserted proof rows must use per-run-unique run_key AND external_id (`${Date.now()}`), or unique-constraint collisions and stale-proof reuse break reruns; the fetch mock's FB ids must be unique per test where a proof lookup by external_id occurs (§13 uses prefix `s13`); findExistingAdId is NOT user-scoped — shared mock ids collide across parallel test files.

## Prior completions (unchanged)

- Prompt 009 Stage 2 COMPLETE (task spine for social posts, PRs #23/#24, staging `b0fbf61`, live proof runs prompt009-live-1/2). TASK_SPINE_GUIDE.md at workspace root is binding for adopters.
- Prompt 016 COMPLETE (Google pull proof, PR #22); 007 v2 (Stripe checkout, PR #21); 006 (external_proofs, PR #20); 015 (spend caps, PR #19); 005 (lifecycle, PR #17/#18); 004 v3 (per-brand Page, PR #16). GBP unverified-for-now (quota 0, Phase H). I-22: recommend defer launcher unification (adopter now shared); I-31: recommend fold into 019+ (tasks #133/#134 CANCELLED — never re-propose).

## Standing credential (I-25)

- Fine-grained PAT scoped to `19JRB71/EchoAI-Foundation` (Contents + Pull requests R/W), stored in `GITHUB_PUSH_TOKEN`, **expires 2026-10-28**. Details in `DEPLOY_CREDENTIALS.md`.

## Environment notes

- Dev server localhost:8080; dev JWT: jsonwebtoken `{userId}` + `JWT_SECRET||SESSION_SECRET`. Staging health `https://staging.zorecho.com/api/health` → version = deploy SHA. Staging admin `admin@staging.zorecho.com` / `$ADMIN_PASSWORD`; read-only DB via `$STAGING_DATABASE_URL` (remember `_` is a LIKE wildcard — use regex `~`).
- Push recipe: fetch token-URL → temp GIT_INDEX_FILE → read-tree FETCH_HEAD → add explicit paths → write-tree → commit-tree → push SHA to new ref; PR via API with `$GITHUB_PUSH_TOKEN`. NEVER `git branch/tag` from the shell (leaves lockfiles that break the owner's Git panel).
- Stripe (test mode, acct `acct_1S02l74bVsLTHBIi`): Starter `price_1TvKgc4bVsLTHBIim45VzLqc` $197, Pro `price_1TvKgc4bVsLTHBIicplSfBs1` $497, Enterprise `price_1TvKgd4bVsLTHBIiSZMuD65v` $997, Seat `price_1TvKgd4bVsLTHBIii3c0ewWv` $50. FREE_TEST_MODE=true on staging.

## Standing rules (unchanged)

End-of-Prompt reports per GLOBAL_PROMPT_RULES; keep the five continuity docs + `.local/.commit_message` updated; one owner step at a time with exact click/see instructions; stop-and-wait; checkpoint SHA lags one message; **STOP AND REPORT** on stop conditions (missing env, price mismatch, non-genuine verification, live mode, wrong tenant, provider failure — no blind retries, detect existing provider objects first); never propose cancelled follow-ups #129/#130 (or #133/#134).
