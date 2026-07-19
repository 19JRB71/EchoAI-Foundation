---
name: Zorecho Department Collaboration architecture
description: System-wide inter-department collaboration design — status and hard constraints
---
`ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md` is the DRAFT system-wide collaboration design (Collaboration Bus + Knowledge Registry + 6 flows + Echo orchestration + appendices A/B).

**Why:** CEO directive (July 19, 2026): Sage V2 is feature complete (bug fixes only), no Phase 7, and NO collaboration implementation may begin until James approves this document. Once approved, it becomes the locked model — implement per its staged rollout (Stage 0 dark first), don't redesign.

**How to apply:** Before any inter-department feature or cross-agent communication work, check this doc's approval status. If unapproved, design-only. Key locked constraints: one owner per topic; lookup vs generation topic classes; anti-loop rule (only Echo plan_id sequences chain); no new execution paths; owner is the disagreement tiebreaker.

**Update (July 19, 2026):** DRAFT v2 — CEO approved in principle and directed three additions, now integrated: §12 Department Performance Scorecards (deterministic weekly per-dept metrics, no autonomous ranking/action), §13 Executive Roundtable (owner-initiated, bounded plan_id Echo plan, no cross-talk, owner decides), §0.7 Collaboration Philosophy principle. Still awaiting FINAL approval — Stage 0 implementation must not begin until then.
