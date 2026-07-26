# COMPLETED_WORK.md — Zorecho Completed Work Log

**Last updated:** 2026-07-26. Append-only; newest first. Milestone-level history predating this file lives in `MILESTONES.md` (authoritative for Sage V2 phases 1–6 and Collab Stage 0).

## 2026-07-26 — REPLIT_PROMPT_014: Tenant-isolation regression suite — COMPLETE

- New dedicated suite (19 tests, tests-only change): `EchoAI/tests/tenantIsolation.core.test.js` (10), `tenantIsolation.surfaces.test.js` (6), `tenantIsolation.background.test.js` (3).
- Coverage: two-tenant direct-id probing (brands, campaigns, leads, social_posts, ad_creatives, email campaigns/recipients, setup sessions, Sage endpoints; integrations & guided progress proven user-scoped with no foreign-id input path); team-member remap correctness (viewer reads owner's data, blocked from admin routes and mutations); background is_demo gating (`publishDuePosts`, `runDailyGoalTracking`); Sage single-brand delivery (`runUrgentScanForBrand(X)` writes scoped to X only).
- All four historical bug classes encoded: client active-brand copies (server-side brand-scoping probes), Sage single-brand delivery, background paths bypassing route gates, is_demo bleed.
- **Defects found: NONE** — every probe returned 403/404 with no data leakage; body-content secret-marker checks + DB re-reads confirm no unauthorized reads or writes. No application code changed.
- Server suite 962 → 981/981 green. Architect review PASS.

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
