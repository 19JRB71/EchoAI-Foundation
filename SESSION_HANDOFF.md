# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-08-03, end of REPLIT_PROMPT_019 Stage 2 build (email-send task spine + unified Approvals Inbox — code complete, PR up, awaiting owner merge + post-merge staging email proof). Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_019 Stage 2 (D-28/D-29, owner-authorized Option (a)): **CODE COMPLETE, PR AWAITING OWNER MERGE.** Branch `prompt-019-email-spine` off staging tip `aa5cd2f`, PR base `staging`. After the owner merges and staging deploys, the **staging live proof is still owed**: send ONE real email through an adopted path to the Prompt-006 proof inbox, capture the full task trail + `send_accept` proof row + Message-ID (D-23 redaction — no recipient addresses in evidence), single-item send only.
- What landed — email spine: `utils/emailSendSpine.js` is the ONE canonical email-send adopter (task_type `email_send`): beginSend (APPROVED→QUEUED→EXECUTING; resumes an existing RETRY_SCHEDULED task) / recordSendAccepted (**Message-ID gate**: zero IDs → EXTERNAL_FAILURE `missing_message_id`, never PROVIDER_ACCEPTED; else PROVIDER_ACCEPTED → external_proofs `send_accept` row with Message-IDs + counts, NEVER recipient addresses → EXTERNALLY_VERIFIED w/ `verification:'message_id_recorded'`, `deliveryConfirmation:'unavailable'` → REPORTED → COMPLETED) / recordSendFailure (classified: AUTH_REQUIRED/PERMISSION_DENIED/RATE_LIMITED/VALIDATION_FAILED/EXTERNAL_FAILURE) / recordRetryScheduled / recordPersistFailure (SMTP accepted but bookkeeping failed → MANUAL_REVIEW, **never resend**). All via safeSpine — spine failures can never break a send.
- Adopted paths: emailMarketingController manual blast (`owner:<id>`), drip scheduler (`system:drip-scheduler`, source `email_marketing_recipient`, below-retry-limit → RETRY_SCHEDULED same task), scheduled blasts (`system:scheduled-blast`); emailCampaignController CRM sequence (source `email_campaign` / `<id>:step-N`); scheduler weekly report (source `weekly_report` / `<brandId>:<isoWeek>`). Spine outcome calls happen post-COMMIT.
- Honest NOT-adopted list (future ratchet): welcome, hot-lead, payment/lockout, invites, appointments, feedback, health-monitor, real-estate, demo inquiries, /api/email/test.
- Approvals Inbox: owner-only `/api/approvals` (auth+lockout+requireOwner). getInbox = live projection (nothing stored): spine MANUAL_REVIEW tasks + 4 adapters (autopilot_batch_items pending under ready batch; growth_actions 'proposed'; company_truth_reports 'pending_approval'; email_drafts 'pending' — user-scoped, never brand-filtered; voice drafts excluded by design). Items badged spine/adapter; response includes counts + ADAPTERS inventory with retirement declarations — **the adapter count is a ratchet, it must only go down**. resolveTask: {resolution:'confirm_handled'|'dismiss', note≤500} → COMPLETED/CANCELLED via a recorded spine transition (actor `owner:<userId>`, meta.via 'approvals_inbox'); 404 foreign/missing, 409 lost race.
- taskSpine changes: MANUAL_REVIEW→COMPLETED legal ONLY when actor starts `owner:` AND meta.resolution present. Reconciliation extended (bookkeeping only, ZERO provider calls): terminal ('sent'/'failed') one-time blasts w/o task → `reconstructEmailBlastTrail` (sent lands at REPORTED w/ `verification:'unavailable'` — reconstruction never invents Message-IDs); stale EXECUTING email_send >30min → MANUAL_REVIEW (`system:stale-rescue`, "some messages may already have gone out").
- Migration `133_email_send_task_type.sql` — additive CHECK widen only (applied to dev + test DBs).
- Client: new **Approvals** section (`approvals`, starter tier) — Sidebar nav button + icon, spine/adapter badges, resolve buttons for spine items, adapter items jump via REAL section ids (autopilot / echogrowth / sage / echoemail — NAVIGATE-marker rule), collapsible adapter inventory; ActivityPanel gained MANUAL_REVIEW "Mark handled"/"Dismiss" buttons (I-31 folded in); api.js getApprovalsInbox/resolveApprovalTask; sw cache **v161**; dist rebuilt and committed.

## Review round (architect) — 019

- PASS, no severe findings. Optional (not done): dedicated tests for weekly-report adoption and CRM-sequence reconciliation.
- Still FLAGGED from 018 (pre-existing, unchanged): autopilotController.approveItem wraps launchFacebookCampaign inside the item-claim transaction (double-launch risk on COMMIT failure). Recommend a small dedicated follow-up prompt.

## Test state

- Server suite **1114/1114** (baseline 1105 + 9 `tests/emailSendSpine.test.js`); client **385/385**; client build clean.
- Test gotchas: agent_task_events must be ordered by `created_at, event_id` (event_id is a random UUID); the manual-blast concurrent race loser gets **400** ("already been sent"), not 409; sendEmail stubbing = patch `require('../utils/email').sendEmail` BEFORE requiring the controllers (they destructure at load); new migrations need `node tests/setupTestDb.js` re-run.

## Prior completions (unchanged)

- Prompt 018 code complete (ad-launch spine, PR up; staging PAUSED-chain proof was completed post-merge 2026-08-03 — see TEST_EVIDENCE_INDEX). Prompt 009 Stage 2 COMPLETE (social-post spine, PRs #23/#24, live proofs). TASK_SPINE_GUIDE.md is binding for adopters.
- Prompt 016 COMPLETE (Google pull proof, PR #22); 007 v2 (Stripe checkout, PR #21); 006 (external_proofs, PR #20); 015 (spend caps, PR #19); 005 (lifecycle, PR #17/#18); 004 v3 (per-brand Page, PR #16). GBP unverified-for-now (quota 0, Phase H). I-22: defer launcher unification. Tasks #129/#130/#133/#134 CANCELLED — never re-propose.

## Standing credential (I-25)

- Fine-grained PAT scoped to `19JRB71/EchoAI-Foundation` (Contents + Pull requests R/W), stored in `GITHUB_PUSH_TOKEN`, **expires 2026-10-28**. Details in `DEPLOY_CREDENTIALS.md`.

## Environment notes

- Dev server localhost:8080; dev JWT: jsonwebtoken `{userId}` + `JWT_SECRET||SESSION_SECRET`. Staging health `https://staging.zorecho.com/api/health` → version = deploy SHA. Staging admin `admin@staging.zorecho.com` / `$ADMIN_PASSWORD`; read-only DB via `$STAGING_DATABASE_URL` (remember `_` is a LIKE wildcard — use regex `~`).
- Push recipe: fetch token-URL → temp GIT_INDEX_FILE → read-tree FETCH_HEAD → add explicit paths → write-tree → commit-tree → push SHA to new ref; PR via API with `$GITHUB_PUSH_TOKEN`. NEVER `git branch/tag` from the shell (leaves lockfiles that break the owner's Git panel).
- Stripe (test mode, acct `acct_1S02l74bVsLTHBIi`): Starter `price_1TvKgc4bVsLTHBIim45VzLqc` $197, Pro `price_1TvKgc4bVsLTHBIicplSfBs1` $497, Enterprise `price_1TvKgd4bVsLTHBIiSZMuD65v` $997, Seat `price_1TvKgd4bVsLTHBIii3c0ewWv` $50. FREE_TEST_MODE=true on staging.

## Standing rules (unchanged)

End-of-Prompt reports per GLOBAL_PROMPT_RULES; keep the five continuity docs + `.local/.commit_message` updated; one owner step at a time with exact click/see instructions; stop-and-wait; checkpoint SHA lags one message; **STOP AND REPORT** on stop conditions (missing env, price mismatch, non-genuine verification, live mode, wrong tenant, provider failure — no blind retries, detect existing provider objects first); never propose cancelled follow-ups #129/#130 (or #133/#134).
