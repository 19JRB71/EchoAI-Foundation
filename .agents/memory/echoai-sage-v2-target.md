---
name: Sage V2 approved architectural target
description: CEO-approved target architecture for Sage; governs all future Sage work — no feature expansion.
---

**Rule:** `SAGE_V2_CHALLENGE_REVIEW.md` (the REVISED plan, not the original `SAGE_V2_ARCHITECTURE.md`) is the CEO-approved architectural target for Sage (approved July 17, 2026). Do not add new Sage capabilities unless they solve a real business problem that cannot be solved within this architecture. Focus: implementation quality, reliability, performance, UX — not feature expansion.

**Why:** James explicitly locked the target after a full code-grounded audit (`SAGE_DEPARTMENT_AUDIT.md`) → blueprint → adversarial review cycle, to prevent scope creep and conflicting narratives.

**How to apply:**
- Any Sage work must map to a phase in the revised plan (P1–P7 in the review doc). P7 (Experiments, Playbooks) is GATED on outcome coverage >50% + 6 months history.
- Key superseded decisions: no adapter dual-write (canonical `sage_intel_items` write path; feed becomes a view), junction tables not uuid[] arrays, no numeric priority score (bucket ranking), ONE weekly customer-facing Sage output (Customer Intelligence weekly is absorbed into Sage), max 3 decisions per weekly session.
- Program success metric: outcome-capture adoption; <30% coverage after 2 months of P3 pauses later phases.
- Baseline fact: sage-deep-research runs DAILY 06:15 (launch cadence), pattern study Tue 05:45 — verify scheduler before any cost claims.
