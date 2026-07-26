# TEST_EVIDENCE_INDEX.md — Zorecho Test & Verification Evidence Index

**Last updated:** 2026-07-25. Per the Evidence rule (`replit.md`), every functional claim needs recorded proof. This file indexes where each piece of evidence lives. Newest first.

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
