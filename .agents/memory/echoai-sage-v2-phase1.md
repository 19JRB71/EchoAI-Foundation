---
name: EchoAI Sage V2 Phase 1
description: Company Truth injection chokepoint, flying-blind stats, weekly briefing consolidation — flags, honesty rules, and the "latest-ever row" staleness trap.
---

**Rules:**
- Three flags in `config/aiControls.js` (DB override → env → default OFF): `SAGE_V2_CONTEXT`, `SAGE_V2_WEEKLY_BRIEFING`, `SAGE_V2_ROI_LABELS`. All Sage V2 endpoints answer `{enabled:false}` when dark — zero behavior change.
- Company Truth is injected at the ONE paid chokepoint (`config/anthropic.js` createMessage/streamMessage) for any brand-scoped call (`meta.brandId`), not per prompt file. Hermes is excluded by construction (separate Nous client). Injection module must NOT require companyTruthController (circular back into the chokepoint) — it reads `company_truth_reports status='approved'` directly.
- Flying-blind counter increments at most once per 15-min cache window per brand (cache hit AND miss), fire-and-forget.
- **Weekly-consolidation staleness trap:** any "gather this week's outputs" aggregator must week-bound EVERY source query (`week_date/period_end/created_at >= since`), never take latest-ever rows — otherwise a months-old report reads as this week's output and breaks the no-fabrication rule. Caught by architect review; regression test inserts 3-week-old rows and asserts all sources unavailable.
- All user-visible Sage V2 copy is `[DRAFT]`-prefixed placeholders in `config/briefingCopy.js` — James finalizes with ChatGPT; keep copy centralized there.

**Why:** Sage V2 P1 (July 2026) per `SAGE_V2_CHALLENGE_REVIEW.md`; briefing honesty is a hard product rule.
