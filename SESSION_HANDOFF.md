# SESSION_HANDOFF.md — Zorecho

**Written:** 2026-07-26, at the close of REPLIT_PROMPT_014. Overwrite this file at the end of every prompt/session.

## Where we are

- REPLIT_PROMPT_014 (tenant-isolation regression suite): **COMPLETE** (2026-07-26).
  - New dedicated suite (tests-only, 19 tests): `EchoAI/tests/tenantIsolation.core.test.js`, `tenantIsolation.surfaces.test.js`, `tenantIsolation.background.test.js`.
  - Coverage: two-tenant direct-id probing on brands, campaigns, leads, social_posts, ad_creatives, email, integrations, setup sessions, guided progress, Sage; team-member remap (viewer can't admin); background is_demo gating (publishDuePosts, runDailyGoalTracking); Sage single-brand delivery.
  - **Defects found: NONE** — nothing to log in open issues; no application code changed.
  - Server suite 981/981 green (`/tmp/prompt014_full_run.log`). Architect review PASS.
- Prior prompts: 012, 013, 001 v2 all **COMPLETE** (2026-07-25) — details in `CURRENT_STATE.md` and `COMPLETED_WORK.md`.
- Repository: tenant-isolation tests + doc updates are committed locally; James pushes via the Git panel.

## Next prompt to execute

Awaiting the next prompt text from the CEO's external prompt series. `GLOBAL_PROMPT_RULES.md` is still not in the repo — worth requesting an upload.

## Standing context for the next session

- Read `CURRENT_STATE.md` first, then `ZORECHO_OPERATIONAL_ROADMAP.md` for execution order and the CEO Operational Validation cadence.
- Rules that always apply: main stays deployable; new functionality dark behind flags; Evidence rule (no functional claim without proof — see `replit.md` User preferences); ChatGPT-approved copy is implemented exactly as approved; remind James to Push after any change that must go live.
- Sage V2 is feature complete (bug fixes only). Collab Stage 1 needs explicit CEO go-ahead.

## Open follow-ups (operational, non-blocking)

1. Restore drill against a real Railway staging backup — `STAGING_DATABASE_URL` is now in Secrets; run the identical `ROLLBACK.md` §3 drill.
2. Enable PITR on both Railway Postgres services.
3. Set a backup schedule on both Railway Postgres services.
