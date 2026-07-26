# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-07-26, at the close of REPLIT_PROMPT_008 v2. Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_008 v2 (honestly disable legacy-FCM mobile push): **COMPLETE** (2026-07-26).
  - `config/fcm.js` hard-disabled behind `FCM_LEGACY_ENABLED` (default off); one boot warning; sends no-op with `reason:'legacy_endpoint_disabled'`; register API says "Mobile push is not available yet."; token registration retained; web push untouched.
  - 3 new tests (fetch tripwire proves the retired endpoint unreachable). Server suite 985/985 green (`/tmp/prompt008_full_run.log`). Architect review PASS.
  - Rollback: `FCM_LEGACY_ENABLED=true` (emergency only).
- REPLIT_PROMPT_014 (tenant-isolation suite): **COMPLETE** (2026-07-26) — 20 tests, zero defects found; reviewer's four evidence gaps closed (commit hash, run tail, active-brand-class justification, background tier-gate test).
- Prior prompts 012, 013, 001 v2: **COMPLETE** (2026-07-25). Details in `CURRENT_STATE.md` / `COMPLETED_WORK.md`.
- Phase A of the CEO's prompt series is fully executed pending reviewer acceptance of 014 and 008.

## Next prompt to execute

Awaiting the next prompt text from the CEO's external series (008 was the last Phase A prompt). `GLOBAL_PROMPT_RULES.md` is still not in the repo — worth requesting an upload.

## Standing context for the next session

- Read `CURRENT_STATE.md` first, then `ZORECHO_OPERATIONAL_ROADMAP.md` for execution order and the CEO Operational Validation cadence.
- Rules that always apply: main stays deployable; new functionality dark behind flags; Evidence rule (no functional claim without proof — see `replit.md` User preferences); ChatGPT-approved copy is implemented exactly as approved; remind James to Push after any change that must go live.
- End-of-Prompt Reports must ALWAYS include: commit hash + `git revert <hash>` line, pasted suite-summary tail, and per-criterion evidence (reviewer requires these verbatim).
- Sage V2 is feature complete (bug fixes only). Collab Stage 1 needs explicit CEO go-ahead.

## Open follow-ups (operational, non-blocking)

1. Restore drill against a real Railway staging backup — `STAGING_DATABASE_URL` is in Secrets; run the identical `ROLLBACK.md` §3 drill.
2. Enable PITR on both Railway Postgres services.
3. Set a backup schedule on both Railway Postgres services.
