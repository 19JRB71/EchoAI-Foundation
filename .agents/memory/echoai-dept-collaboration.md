---
name: Zorecho Department Collaboration architecture
description: System-wide inter-department collaboration design — status and hard constraints
---
`ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md` is the ✅ APPROVED (July 19, 2026) LOCKED system-wide collaboration design (Collaboration Bus + Knowledge Registry + 6 flows + Echo orchestration + appendices A/B).

**Why:** CEO directive (July 19, 2026): Sage V2 is feature complete (bug fixes only), no Phase 7, and NO collaboration implementation may begin until James approves this document. Once approved, it becomes the locked model — implement per its staged rollout (Stage 0 dark first), don't redesign.

**How to apply:** Before any inter-department feature or cross-agent communication work, check this doc's approval status. If unapproved, design-only. Key locked constraints: one owner per topic; lookup vs generation topic classes; anti-loop rule (only Echo plan_id sequences chain); no new execution paths; owner is the disagreement tiebreaker.

**Update (July 19, 2026):** DRAFT v2 — CEO approved in principle and directed three additions, now integrated: §12 Department Performance Scorecards (deterministic weekly per-dept metrics, no autonomous ranking/action), §13 Executive Roundtable (owner-initiated, bounded plan_id Echo plan, no cross-talk, owner decides), §0.7 Collaboration Philosophy principle. Still awaiting FINAL approval — Stage 0 implementation must not begin until then.

**Update (July 19, 2026, later):** CEO gave FINAL approval; doc is the permanent baseline (changes only by CEO-approved amendment). **Stage 0 is BUILT and dark**: `models/122_collaboration_bus.sql` (department_messages, anti-loop CHECK: requests never carry correlation_id; plan_id Echo-requests-only; one-response partial unique index), `config/knowledgeRegistry.js` (10 topics, one owner each, strict reject-not-strip schemas, honest-empty available/reason, secret denylist deep scan), `utils/collaborationBus.js` (single chokepoint; owner-only claim/respond/report, alerts only via Echo, demo brands excluded, daily cap, dedup-from-log, transactional respond), maintenance as a guarded branch in runSageOpportunityMaintenance (no new job). 10 COLLAB_* flags registered ALL OFF in aiControls. 16 bus tests; full suite 925 pass. Architect review PASS. Report: `COLLAB_STAGE0_COMPLETION_REPORT.md`. **Stage 1 (COLLAB_LEAD_INTEL) must NOT start without explicit CEO go-ahead.** Note: getSwitch() is async and throws on unregistered names — busEnabled awaits it.
