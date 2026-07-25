# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-07-25, at the close of REPLIT_PROMPT_012. Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_012 (Backup & Baseline): **COMPLETE**. Full pre-turnaround safety net is in place:
  - GitHub `main` pushed; tag `pre-turnaround-baseline` + branch `backup/pre-turnaround` created.
  - Railway backups captured for production and staging (IDs in `ROLLBACK.md` §2).
  - Restore procedure proven end-to-end on the dev database (`ROLLBACK.md` §3).
- Repository is clean: no uncommitted application-code changes; all tests green at last validation (951 server / 385 client / client build).

## Next prompt to execute

**REPLIT_PROMPT_001** — the first prompt of the turnaround sequence (prompt text supplied by James via the ChatGPT → CEO-approval workflow). Nothing blocks it: the staging-backup restore drill is recorded as an operational follow-up, not a prerequisite (the roadmap does not require it before Prompt 001).

## Standing context for the next session

- Read `CURRENT_STATE.md` first, then `ZORECHO_OPERATIONAL_ROADMAP.md` for execution order and the CEO Operational Validation cadence.
- Rules that always apply: main stays deployable; new functionality dark behind flags; Evidence rule (no functional claim without proof — see `replit.md` User preferences); ChatGPT-approved copy is implemented exactly as approved; remind James to Push after any change that must go live.
- Sage V2 is feature complete (bug fixes only). Collab Stage 1 needs explicit CEO go-ahead.

## Open follow-ups (operational, non-blocking)

1. Restore drill against a real Railway staging backup — needs the staging DB public connection URL in Secrets; then run the identical `ROLLBACK.md` §3 drill.
2. Enable PITR on both Railway Postgres services.
3. Set a backup schedule on both Railway Postgres services.
