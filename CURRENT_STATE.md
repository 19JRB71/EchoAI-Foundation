# CURRENT_STATE.md — Zorecho Project State

**Last updated:** 2026-07-25 (close of REPLIT_PROMPT_012)
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

- Server suite: 951/951 passing. Client suite: 385/385 passing. Client production build: green.
- Evidence index: `TEST_EVIDENCE_INDEX.md`.

## Open operational follow-ups (not blockers)

1. Restore drill against a real Railway staging backup (needs the staging DB public URL in Secrets).
2. Enable PITR on both Railway Postgres services (currently OFF).
3. Set a backup schedule on both Railway Postgres services (currently none).

## Prompt series status

- REPLIT_PROMPT_012 (Backup & Baseline): **COMPLETE** (2026-07-25).
- REPLIT_PROMPT_013 (test-env bootstrap & suite hygiene): **COMPLETE** (2026-07-25) — clean checkout now runs `npm test` green with zero secrets configured (test-only dummy defaults in the guarded preload); ordering-sensitive failure root-caused (env dependency, not cross-file leak) and gone; suite 962/962 both with and without env vars. Evidence in `TEST_EVIDENCE_INDEX.md`.
- REPLIT_PROMPT_001 v2 (token encryption + Stripe webhook signatures): **COMPLETE** (2026-07-25) — verification-only outcome (no code gaps found); 11 new security tests green (server suite 962/962); staging SQL ciphertext check PASSED (all 4 token columns show ciphertext, evidence in `TEST_EVIDENCE_INDEX.md`). Bonus: `STAGING_DATABASE_URL` secret now available for the restore-drill follow-up.
