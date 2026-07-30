---
name: EchoAI campaign lifecycle state machine
description: campaigns.status honest states, single verification authority, and consumer semantics after Prompt 005
---

# Campaign lifecycle (ads campaigns table)

- Legal states: draft, approved, created_paused, live, completed, failed, launch_failed. Legacy 'active' retired (migration mapped all → created_paused; column default now created_paused).
- **Rule:** NO code may write `campaigns.status` directly. All changes go through `utils/campaignState.js#transitionCampaignStatus` (guarded UPDATE, illegal transitions throw). `created_paused⇔live` (both directions) is reserved to `utils/campaignVerification.js#verifyCampaignStatus` via a private authority token — the ONLY writer of `live`, from a GET-only Graph read-back requiring campaign + ad set + EVERY ad `status` AND `effective_status` == ACTIVE (zero ads ≠ live). Failed read-back: state unchanged + `last_verify_error`; success: `last_verified_at`.
- **Why:** audit P0-1 — rows claimed "active" while every FB object was PAUSED; committed spend counted from launch. Owner-binding addendum (Prompt 005 v3) + explicit owner ruling that Autonomous Growth may request provider actions but never write domain state (prevents regressions reintroducing direct writes).
- **How to apply:** new features touching campaign status must call the machine/verifier, never raw SQL. Committed-spend/budget aggregates count ONLY 'live'. "Does this brand run ads" presence checks use IN ('created_paused','live'). Unpause (Prompt 015) must flip live via verifyCampaignStatus, never directly. Autonomous Growth is scoped to 'live' rows (dormant until unpause exists). launch_failed→approved→created_paused retry transitions are legal but have no endpoint yet (reuse duplicate-ad guard when built).
- Test-fake trap: test/recurringSweeps.test.js fakes match scheduler SQL by regex incl. the status literal — changing consumer SQL breaks those regexes, not real behavior.
