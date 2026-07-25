# TEST_EVIDENCE_INDEX.md — Zorecho Test & Verification Evidence Index

**Last updated:** 2026-07-25. Per the Evidence rule (`replit.md`), every functional claim needs recorded proof. This file indexes where each piece of evidence lives. Newest first.

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
