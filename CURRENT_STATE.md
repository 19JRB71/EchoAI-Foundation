# CURRENT_STATE.md — Zorecho Project State

**Last updated:** 2026-07-26 (close of REPLIT_PROMPT_008 v2)
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

- Server suite: 985/985 passing (2026-07-26).
- Mobile push (legacy FCM): **honestly disabled** (Decision D-12, Prompt 008) — retired endpoint unreachable; sends no-op with `reason: 'legacy_endpoint_disabled'`; token registration retained; re-enable only via `FCM_LEGACY_ENABLED=true` (emergency rollback only). Web push unaffected. Client suite: 385/385 passing. Client production build: green.
- Evidence index: `TEST_EVIDENCE_INDEX.md`.

## Open operational follow-ups (not blockers)

1. Restore drill against a real Railway staging backup (needs the staging DB public URL in Secrets).
2. Enable PITR on both Railway Postgres services (currently OFF).
3. Set a backup schedule on both Railway Postgres services (currently none).

## Prompt series status

- REPLIT_PROMPT_012 (Backup & Baseline): **COMPLETE** (2026-07-25).
- REPLIT_PROMPT_013 (test-env bootstrap & suite hygiene): **COMPLETE** (2026-07-25) — clean checkout now runs `npm test` green with zero secrets configured (test-only dummy defaults in the guarded preload); ordering-sensitive failure root-caused (env dependency, not cross-file leak) and gone; suite 962/962 both with and without env vars. Evidence in `TEST_EVIDENCE_INDEX.md`.
- REPLIT_PROMPT_008 v2 (disable legacy-FCM mobile push): **COMPLETE** (2026-07-26) — `config/fcm.js` hard-disabled behind `FCM_LEGACY_ENABLED` (default off), one boot warning, `sendToTokens`/`sendToUser` no-op with `reason:'legacy_endpoint_disabled'`; register API says "Mobile push is not available yet"; no web-UI surface mentions mobile push (grep-proven); 3 new tests incl. fetch tripwire; suite 985/985. Web push untouched.
- REPLIT_PROMPT_014 (tenant-isolation regression suite): **COMPLETE** (2026-07-26) — three new suites `EchoAI/tests/tenantIsolation.{core,surfaces,background}.test.js` (20 tests) cover direct-id probing on brands/campaigns/leads/social_posts/ad_creatives/email/integrations/setup sessions/guided progress, team-member remap (viewer can't admin), background is_demo gating (publishDuePosts, runDailyGoalTracking), background tier-gating (maybeStartSequenceForLead enforces the Pro gate itself on the sweep path), and Sage single-brand delivery. **Defects found: NONE** — verification outcome, zero application-code changes. Server suite 982/982.
- REPLIT_PROMPT_001 v2 (token encryption + Stripe webhook signatures): **COMPLETE** (2026-07-25) — verification-only outcome (no code gaps found); 11 new security tests green (server suite 962/962); staging SQL ciphertext check PASSED (all 4 token columns show ciphertext, evidence in `TEST_EVIDENCE_INDEX.md`). Bonus: `STAGING_DATABASE_URL` secret now available for the restore-drill follow-up.
