# CHANGELOG.md — Zorecho

Newest first. Documentation-only entries are marked (docs). For deep milestone history see `MILESTONES.md`.

## 2026-07-25

- REPLIT_PROMPT_001 v2 executed: verification-only (no code gaps). Added `test/encryptionRoundTrip.test.js` + `test/stripeWebhookSignature.test.js` (11 tests); server suite 962/962 green. Status PARTIALLY COMPLETE pending CEO staging SQL ciphertext screenshot.

- (docs) REPLIT_PROMPT_012 (Backup & Baseline) closed as **COMPLETE**. Continuity documents introduced: `CURRENT_STATE.md`, `COMPLETED_WORK.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`, `TEST_EVIDENCE_INDEX.md`.
- (docs) `ROLLBACK.md` §1/§2 updated with the actual GitHub tag/branch creation and Railway backup IDs (prod 22:56 UTC 940 MB; staging 22:58 UTC 885 MB).
- Ops: removed stale `.git/refs/tags/pre-turnaround-baseline.lock` that blocked Git panel pushes (INDEX_LOCKED).
- GitHub: tag `pre-turnaround-baseline` published; branch `backup/pre-turnaround` created (by James).
- (docs) `ROLLBACK.md` created with restore-drill evidence (dev DB dump/restore, 0 errors, schema fully current).

## 2026-07-24

- Review package `ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24.zip` built for outside architect review (docs + sanitized source; secret-scanned).
- Brand profile saving & error handling improved; Echo constrained to English during brand discovery (see git history for the full day's commits).

## Before 2026-07-24

See `MILESTONES.md` (Sage V2 Phases 1–6, Department Collaboration Stage 0) and git history (`git log`).
