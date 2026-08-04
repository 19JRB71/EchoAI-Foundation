# SENTINELS.md — Retroactive Sentinel Audit (D-32 / I-35)

**Audit date:** 2026-08-04 (UTC)
**Audit tree:** fresh clone of staging tip — base SHA `ee7ce28c9fa6571a5cb2a1f1dfaf7b19cdda3daa` (merge of PR #28, Prompt 010 repair). The dev workspace was NOT used as a source of truth.
**Method:** for each sentinel, the expected signature is the git blob hash of the artifact at its accepted source commit; the current signature is the blob hash at the audited staging tip. Where hashes differ, the full commit history of the file between acceptance and the tip was inspected: a verdict of **MATCH (evolved)** means every intervening change came from a later *accepted* prompt commit and the accepted functional signatures were re-verified by grep and by the passing dedicated test suite. **CLOBBERED** would mean an intervening change removed accepted behavior; **MISSING** means the artifact is absent from the tip.

**Sentinels checked: 41** (31 file artifacts across 17 sentinel groups + 10 migrations verified individually within them).
**Verdict summary: 41 MATCH · 0 MISSING · 0 CLOBBERED** (the previously CLOBBERED Prompt 010 set was repaired in PR #28, which is part of the audited tip and verified below as restored-exact).

| Sentinel | Artifact path | Accepted commit | Expected blob | Current blob | Verdict |
|---|---|---|---|---|---|
| P003 createPausedAd / PAUSED-only launch | EchoAI/utils/facebookApi.js | a7520de | 284131a0 | 30481144 | MATCH (evolved: only 8e6a45c, accepted P003 error-detail PR; PAUSED×5, error_user_msg present) |
| P003 PAUSED-only launch tests | EchoAI/tests/setupAgent.facebookCampaign.test.js | a7520de | 681e6a62 | 5c147219 | MATCH (evolved: bc6ee20 changed 1 line, 'active'→'created_paused' per accepted P005 state machine; 4 tests intact) |
| P003 ad-object migration | EchoAI/models/126_facebook_ad_object.sql | a7520de | 6af50c15 | 6af50c15 | MATCH |
| P003 Graph create-field regression tests | EchoAI/tests/facebookAdObject.test.js | 98c0a50 | 51fee24d (as extended by accepted 1565a35) | ecb7fc5b | MATCH (evolved: extended by accepted later prompts; bid_strategy, promoted_object, is_adset_budget_sharing_enabled, advantage_audience signatures all present in tree) |
| P004 per-brand FB Page/link migration | EchoAI/models/127_brand_ad_destination.sql | 1565a35 | 5687f52f | 5687f52f | MATCH |
| P004 brand-destination tests | EchoAI/tests/facebookAdObject.test.js | 1565a35 | 51fee24d | ecb7fc5b | MATCH (evolved; brand-column fixture tests present, suite green) |
| P005 campaignState machine | EchoAI/utils/campaignState.js | bc6ee20 | c7cc4ae4 | c7cc4ae4 | MATCH |
| P005 state-machine migration | EchoAI/models/128_campaign_state_machine.sql | bc6ee20 | 52c287c7 | 52c287c7 | MATCH |
| P005 state-machine tests | EchoAI/tests/campaignStateMachine.test.js | bc6ee20 | a8ed2291 | 6eeed543 | MATCH (evolved: only 7d00247, accepted P018) |
| P005 campaignVerification (sole live-writer) | EchoAI/utils/campaignVerification.js | bc6ee20 | 1cf8ecec | f5171f23 | MATCH (evolved: only 7d00247, accepted P018 spine adoption) |
| P015 spend caps | EchoAI/utils/spendCaps.js | cc92ea0 | 3e552c8a | 3e552c8a | MATCH |
| P015 spend-caps migration | EchoAI/models/129_ad_spend_caps.sql | cc92ea0 | a58b3dc3 | a58b3dc3 | MATCH |
| P015 spend-cap control tests | EchoAI/tests/spendCapControls.test.js | cc92ea0 | 1e69e445 | 1e69e445 | MATCH |
| P006 external_proofs writer/immutability | EchoAI/utils/externalProofs.js | 17206c9 | 59dd6e7d | 59dd6e7d | MATCH |
| P006 external_proofs migration | EchoAI/models/130_external_proofs.sql | 17206c9 | 736851d8 | 736851d8 | MATCH |
| P006 external_proofs tests | EchoAI/tests/externalProofs.test.js | 17206c9 | 5a719c12 | 5a719c12 | MATCH |
| P007 Stripe staging proof tests | EchoAI/tests/stripeStagingProof.test.js | b611440 | 04975e79 | 04975e79 | MATCH |
| P016 Google pull proof tests | EchoAI/tests/googleStagingProof.test.js | 67d601d | 819c8bd0 | 819c8bd0 | MATCH |
| P009 taskSpine | EchoAI/utils/taskSpine.js | c60084a | fd69ca5f | d00c0d56 | MATCH (evolved: only 7d00247 + 9d8a637, accepted P018/P019 adopters) |
| P009 agent_tasks migration | EchoAI/models/131_agent_tasks.sql | c60084a | c70c2613 | c70c2613 | MATCH |
| P009 taskSpine tests | EchoAI/tests/taskSpine.test.js | c60084a | 1ea6a838 | 40f6d96a | MATCH (evolved: only 9a8c7c6, accepted P020) |
| P018 adLaunchSpine | EchoAI/utils/adLaunchSpine.js | 7d00247 | 333f78e9 | 333f78e9 | MATCH |
| P018 ad-launch task-type migration | EchoAI/models/132_ad_launch_task_type.sql | 7d00247 | ace62e5a | ace62e5a | MATCH |
| P018 adLaunchSpine tests | EchoAI/tests/adLaunchSpine.test.js | 7d00247 | e2279266 | 5798e7da | MATCH (evolved: only 9a8c7c6, accepted P020) |
| P019 emailSendSpine | EchoAI/utils/emailSendSpine.js | 9d8a637 | dca5608d | dca5608d | MATCH |
| P019 email task-type migration | EchoAI/models/133_email_send_task_type.sql | 9d8a637 | b75a3e04 | b75a3e04 | MATCH |
| P019 emailSendSpine tests | EchoAI/tests/emailSendSpine.test.js | 9d8a637 | d2b67003 | d2b67003 | MATCH |
| P019 unified Approvals Inbox | EchoAI/controllers/approvalsController.js | 9d8a637 | 05094f1c | 05094f1c | MATCH |
| P020 executeExternal ledger gateway | EchoAI/utils/executeExternal.js | 9a8c7c6 | 1d037ccd | 1d037ccd | MATCH |
| P020 external_actions migration | EchoAI/models/134_external_actions.sql | 9a8c7c6 | 3215d46f | 3215d46f | MATCH |
| P020 executeExternal tests | EchoAI/tests/executeExternal.test.js | 9a8c7c6 | d0067f02 | d0067f02 | MATCH |
| P010 scheduler gate + job claims (restored) | EchoAI/utils/scheduler.js | 85c76dc (restoring ea103d9) | bc0aa45b | bc0aa45b | MATCH |
| P010 job_runs migration (restored) | EchoAI/models/125_job_runs.sql | 85c76dc (restoring ea103d9) | 07bb7aee | 07bb7aee | MATCH |
| P010 jobRuns tests (restored) | EchoAI/tests/jobRuns.test.js | 85c76dc (restoring ea103d9) | 9a6318a7 | 9a6318a7 | MATCH |
| P010 report (restored) | EchoAI/PROMPT_010_REPORT.md | 85c76dc (restoring ea103d9) | a3e3eb03 | a3e3eb03 | MATCH |
| FCM disable behavior | EchoAI/config/fcm.js | bf12db8 | c78e0724 | c78e0724 | MATCH |
| Tenant-isolation core tests | EchoAI/tests/tenantIsolation.core.test.js | a106744 | 1a1eb101 | 0027964e | MATCH (evolved: bc6ee20 changed 1 line, 'active'→'created_paused' per accepted P005; 10 tests intact) |
| Tenant-isolation surface tests | EchoAI/tests/tenantIsolation.surfaces.test.js | a106744 | 39c8c69a | 39c8c69a | MATCH |
| Tenant-isolation background tests | EchoAI/tests/tenantIsolation.background.test.js | a106744 | 7cf011e3 | 7cf011e3 | MATCH |
| Database-guard preload | EchoAI/tests/dbGuard.js | 62ea1fc | 0a6c356d | 0a6c356d | MATCH |
| Database-guard tests | EchoAI/tests/dbGuard.test.js | 62ea1fc | e11473e1 | e11473e1 | MATCH |

## Migrations 125–134
All ten migration files exist at the audited tip and are byte-identical to their accepted source commits (blob hashes above): 125_job_runs, 126_facebook_ad_object, 127_brand_ad_destination, 128_campaign_state_machine, 129_ad_spend_caps, 130_external_proofs, 131_agent_tasks, 132_ad_launch_task_type, 133_email_send_task_type, 134_external_actions.

## Deletion/rename history affecting accepted artifacts
Full `git log -m --diff-filter=DR --summary` from the accepted-work baseline (`62ea1fc`) to the audited tip. Deletions of accepted prompt artifacts (all in `9d8a637`, Prompt 019 full-tree snapshot — repaired by PR #28):
- deleted `EchoAI/models/125_job_runs.sql`
- deleted `EchoAI/tests/jobRuns.test.js`
- deleted `EchoAI/PROMPT_010_REPORT.md`
- deleted `.agents/memory/echoai-job-runs-claims.md` (agent memory, non-code)

All other deletions/renames in the history are `EchoAI/client/dist/assets/index-*.js/.css` build-artifact churn from committed client rebuilds — no accepted source artifact affected. Additionally, `bc6ee20` (Prompt 005 full-tree snapshot) clobbered the Prompt 010 instrumentation *inside* `EchoAI/utils/scheduler.js` without a file deletion; that is the incident that motivated this audit and was repaired by PR #28.

## Test run provenance
- All tests were run from this same fresh merged-staging checkout at `ee7ce28` (not the dev workspace).
- **Canonical server suite total: 1130 / 1130 pass** (baseline 1125 + 5 restored jobRuns tests).
- **Client suite: 385 / 385 pass** (34 files).

## Standing rules acknowledged (binding henceforth)
1. Snapshot commits are banned.
2. Every future change is applied to a fresh checkout of the declared base SHA.
3. Every PR report enumerates deletions and renames from the actual git diff (`git diff --stat -M --diff-filter=DR` + summary).
4. Any deletion outside prompt scope is an automatic STOP AND REPORT.
5. Test baselines are valid only when run from the merged staging tree.
6. This file must be rechecked after every future merge.
