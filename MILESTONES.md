# Zorecho — Sage V2 Milestones

Approved development lifecycle for every phase (no stage skipped):
Architecture review → Implementation → Testing → Architect self-review →
Completion report → CEO approval before proceeding.

Standing rules: backward compatible, all new functionality behind feature
flags until approved for release; if an architectural conflict is discovered,
stop and document it before making changes. **Every milestone is a release
candidate:** each completed milestone must leave the repository safely
deployable — migrations idempotent, all tests green, new functionality dark
behind flags — so main stays stable and any milestone is a rollback point. Blueprint of record:
`SAGE_V2_CHALLENGE_REVIEW.md` (revised phase plan, Part 4).

| Milestone | Scope | Status |
|---|---|---|
| **Milestone 1: Sage V2 – Phase 1** | Company Truth consumption everywhere + flying-blind nudge + ROI "Estimated" labels + one-weekly-output briefing consolidation. Flags: `SAGE_V2_CONTEXT`, `SAGE_V2_WEEKLY_BRIEFING`, `SAGE_V2_ROI_LABELS` (all OFF). Report: `SAGE_V2_PHASE1_COMPLETION_REPORT.md`. | ✅ Approved July 17, 2026 |
| **Milestone 2: Sage V2 – Phase 2** | Canonical `sage_intel_items` store (feed becomes a view; junction tables; ingestion redaction + sensitive flag; data-quality sentry) + job-queue claim table + input-hash skip gates on ALL AI jobs including the existing deep cycle. Flags: `SAGE_V2_INTEL_STORE`, `SAGE_V2_JOB_QUEUE`, `SAGE_V2_SKIP_GATES`, `SAGE_V2_DQ_SENTRY` (all OFF). Authoritative record: the Phase 2 Completion Report (July 17, 2026) + `SAGE_V2_PHASE2_ARCHITECTURE.md` as-built notes. | ✅ Approved July 17, 2026 |
| **Milestone 3: Sage V2 – Phase 3** | Outcome capture + attribution fields + coverage displays (may run parallel to Phase 2). Flags: `SAGE_V2_OUTCOME_CAPTURE`, `SAGE_V2_COVERAGE_DISPLAYS` (both OFF). Authoritative as-built record: `SAGE_V2_PHASE3_ARCHITECTURE.md` §6 (completion report) + §6.1 (locked coverage-denominator definition). Standing rule: Phase 3 outcomes are **measurement-only** — no recommendation, strategy, or learning behavior may consume them until the approved later phase. | ✅ Approved July 17, 2026 |
| **Milestone 4: Sage V2 – Phase 4** | Offers + constraints + Company Truth v2 inputs + Executive Memory. Gate: Phase 2. Flags: `SAGE_V2_OFFERS`, `SAGE_V2_CONSTRAINTS`, `SAGE_V2_TRUTH_INPUTS`, `SAGE_V2_EXEC_MEMORY` (all OFF). Authoritative record: `SAGE_V2_PHASE4_ARCHITECTURE.md`. | ✅ Approved (CEO confirmation July 19, 2026) |
| **Milestone 5: Sage V2 – Phase 5** | Opportunity queue (bucket-ranked, 3 decisions weekly) + Directive Bus + decisions table + Change Diagnostics + "What Sage knows" page. Gate: Phases 2–4. Flags: `SAGE_V2_OPPORTUNITIES`, `SAGE_V2_DIRECTIVES`, `SAGE_V2_CHANGE_DIAGNOSTICS`, `SAGE_V2_KNOWLEDGE_PAGE` (all OFF). CEO refinements applied: deterministic tier-based confidence explanation (no percentages) + executive lifecycle labels as pure client mapping. Authoritative record: `SAGE_V2_PHASE5_ARCHITECTURE.md` + Phase 5 Completion Report (July 19, 2026). | ✅ Approved July 19, 2026 |
| **Milestone 6: Sage V2 – Phase 6** | Deterministic channel scorecards + honest forecasts + Executive Debate + Top-3-bets strategy object (CEO refinement: objective / expected timeframe / primary KPI / success threshold / review date required per bet) + self-eval scorecard. Gate: Phases 3, 5. Flags: `SAGE_V2_SCORECARDS`, `SAGE_V2_FORECASTS`, `SAGE_V2_STRATEGY`, `SAGE_V2_SELF_EVAL` (all OFF). Authoritative record: `SAGE_V2_PHASE6_ARCHITECTURE.md` (+ §23 as-built) + `SAGE_V2_PHASE6_COMPLETION_REPORT.md`. **Sage V2 is now feature complete — bug fixes only unless a critical architectural issue is discovered (CEO directive, July 19, 2026).** | ✅ Approved July 19, 2026 |
| **Milestone 7: Sage V2 Complete** | Phase 7 (gated): Experiment Engine + Playbooks from real aggregates — only when outcome coverage >50%, 6 months history, and Phase 6 adoption evidence. Then copy finalization (with ChatGPT) and staged flag enablement for public release. | Pending |
| **Department Collaboration Architecture** | System-wide collaboration model: Collaboration Bus + Knowledge Registry + 6 v1 flows + Echo orchestration + Sage as executive intelligence + CEO Additions 1–3 (Department Performance Scorecards, Executive Roundtable, Collaboration Philosophy). Authoritative record: `ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md` — the permanent baseline; any architectural change returns for CEO approval. Implementation staged 0–4, each stage CEO-gated, all flags OFF until testing complete. | ✅ Architecture Approved July 19, 2026 |
| **Collab Stage 0: Foundation (dark)** | `department_messages` migration + `collaborationBus.js` chokepoint + Knowledge Registry + expiry sweep + all collaboration flags (OFF) + full automated tests (925 server / 372 client, 0 regressions) + architect review (PASS) + `COLLAB_STAGE0_COMPLETION_REPORT.md`. No Stage 1 until CEO approval. | ✅ Completed July 19, 2026 |

Program-level success metric: **outcome-capture adoption**. If coverage <30%
after two months of Phase 3, everything below Phase 5 pauses and the capture
UX is rebuilt first.
