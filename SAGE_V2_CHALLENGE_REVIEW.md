# SAGE V2 — FINAL ARCHITECT REVIEW (ADVERSARIAL)
**Date:** July 17, 2026 · No code written. This report attacks `SAGE_V2_ARCHITECTURE.md` using an independent architect review plus direct re-verification against the current codebase. Where the blueprint is wrong, this document says so plainly and revises it. The verdict and the revised architecture are at the end.

---

## Part 1 — Architecture weaknesses found

### W1. The blueprint already contains stale facts (proof the process needs guards)
The blueprint states the deep cycle runs every 6 hours. **Wrong — verified against `utils/scheduler.js` lines 834–843:** `sage-deep-research` was moved to **daily 06:15** ("launch cadence"), and the pattern study runs **Tuesday 05:45**, not Monday. My own cost math in §15 ("~120 Claude calls/month baseline") was therefore ~4× too high, which distorted the "new costs are small relative to baseline" argument. The real baseline is ~30 deep-cycle calls/brand/month, so V2's proposed additions (~5–8 Claude + ~30 Hermes) are a **20–25% increase**, not a rounding error.
**Lesson institutionalized:** any architecture claim about current behavior must cite file+line and be re-verified at implementation time. If the blueprint drifted in 3 hours, it will drift over a 7-phase build.

### W2. The adapter dual-write model is a technical-debt trap (most serious design flaw)
The blueprint keeps every V1 table (`sage_intelligence_feed`, `competitor_ads`, `competitor_website_changes`, …) as "raw stores" and adds thin adapters writing normalized copies into `sage_intel_items`. The review board is right: this is **dual-write drift by design** — two sources of truth, replay/backfill dedup edge cases, and "which table does the UI read?" ambiguity forever. Nobody ever deletes the adapters.
**Revision:** one canonical write path. New collectors write **only** `sage_intel_items`. The existing Sage feed *becomes a view over* intel items (the feed table's dual-key dedup, soft-dismiss, and columns map 1:1 — this is a migration, not a parallel copy). Raw payloads that don't fit the item shape (full ad snapshots, site diffs) stay in their tables as *detail records linked from* the item (`source_ref`), never re-synced. No adapters, no replay jobs.

### W3. Array-column schema is anti-relational
`evidence_item_ids uuid[]` and `dependencies uuid[]` on `sage_opportunities` lose FK integrity, make "which opportunities cite this finding?" queries ugly, and rot silently when items are deleted.
**Revision:** junction tables `sage_opportunity_evidence(opportunity_id, item_id)` and `sage_opportunity_deps(opportunity_id, depends_on_id)` with real FKs. Same for experiment→directive links. Status fields get CHECK constraints, matching how the house schema already treats lifecycle columns (e.g. `company_truth_reports.status`).

### W4. False precision in priority scoring
`impact×confidence÷(cost+effort)` looks mathematical but most SMB opportunities will have null impact estimates and categorical effort — the formula would manufacture authority from missing data, the exact sin the honesty invariant forbids.
**Revision:** no numeric score. Opportunities are ranked by a **transparent bucket sort** (evidence confidence tier → expiry urgency → owner-relevant category), max 5 open as designed, and the UI says *why* something is first ("2 verified sources, expires in 6 days") instead of showing a fake score.

### W5. Approval fatigue still not actually solved
V2 adds four new approval types on top of autopilot, Company Truth, and competitor confirmations. A cap plus expiry mitigates volume, not *cognitive load* — every item is still a context switch.
**Revision:** **one weekly decision session** as the *only* default surface: Monday briefing presents at most 3 decisions (Echo already owns the briefing), everything else waits or expires. The Opportunities tab exists for owners who want more, but Sage never pushes beyond the weekly 3. Trust-graduation (consistently-approved categories become notify-only) moves from "future idea" to a designed feature with a table column (`auto_approve_category` on brand settings, owner-set only).

### W6. Role duplication remains — V2 would create a FIFTH Monday narrative
The blueprint said "consolidate the four Monday reports" in P1 but then adds Opportunity Synthesis, channel scorecards, forecasts, and a self-eval scorecard — new weekly artifacts that overlap Customer Intelligence, ROI snapshots, Self-Review, and Autopilot learning. Conflicting narratives are a *customer trust* bug, not a cosmetic one.
**Revision (hard rule):** **Sage produces exactly one weekly customer-facing output** — the briefing section containing: what changed (diagnostics), up to 3 decisions, and active-work status. Customer Intelligence's weekly Enterprise report is **absorbed into Sage** (it is intelligence, not execution — department boundary correction). Channel scorecards and forecasts are *always-current views*, not weekly reports. Self-review stays admin-only.

### W7. Scalability: the single-process cron loop fails before 1k customers
Verified pattern: every scheduled job loops brand-by-brand in-process. At ~1,000 brands, daily deep research alone (≈30–60s of AI latency per brand, serial) takes 8–16 hours — jobs start missing windows and stacking. At 10k+, Postgres contention and Anthropic rate limits make it non-viable. 100k is out of the question on this architecture.
**Honest scale assessment:** current design is fine to ~200–300 active AI brands. That is **the right ceiling to accept today** — but V2 must not make it worse.
**Revision:** (a) no new per-brand recurring AI jobs beyond the weekly synthesis (the blueprint's monthly/quarterly jobs fold into it); (b) the input-hash skip gate (already designed) becomes **mandatory on every AI job including the existing deep cycle** — unchanged inputs = zero calls; (c) a `sage_job_queue` claim table (`FOR UPDATE SKIP LOCKED`, the house pattern) so N workers *can* drain brands in parallel when needed — this is ~a day of work now and removes the future rewrite, without introducing any queue infrastructure.

### W8. Privacy gap in conversation/outcome mining
Mining objections and outcomes from conversations into a shared intel store risks leaking customer PII into prompts and cross-surface displays.
**Revision:** ingestion-layer redaction (themes only, code-enforced: names/phones/emails stripped before the item row is written), items from conversation mining flagged `sensitive`, owner-only visibility (existing owner-guard pattern), and excluded from any future cross-brand aggregation unconditionally.

### W9. Missing CEO-grade capabilities (the review's strongest "what's missing")
The blueprint measures and recommends, but cannot **explain**. A real CMO answers "why did leads drop?" with a decomposition, compares options before recommending, and states the cost of doing nothing. Three additions:

1. **Change Diagnostics (the "why" engine)** — deterministic week-over-week decomposition over data we already have: Δleads = Δspend effect + ΔCTR effect + Δconversion effect + channel mix shift, each term computed from `analytics` + leads tables; AI only narrates the computed decomposition. Answers "why did leads/ads/close-rate change" with arithmetic, not vibes. **Medium effort, very high value — promoted into the core plan.**
2. **Executive Debate Engine (James's addition — accepted, with a cost guard)** — for *significant* strategy items only (budget allocation, channel mix, quarterly priorities — NOT every opportunity): one Claude call generates ≥3 realistic options with tradeoffs, risks, and "do nothing" as a mandatory baseline option; the comparison is **stored** on the strategy item (`options_considered jsonb`) and shown to the owner. This directly satisfies Explainability (why / alternatives / why-this-one / risk / cost-of-nothing). Low effort (one prompt + one column), high trust value. Guard: max ~2 debates/brand/month, triggered by strategy events, never scheduled.
3. **Executive Memory (business memory beyond marketing)** — the blueprint's learning loop remembers *recommendation outcomes*; it forgets everything else an executive knows. New `sage_memory` table: brand-scoped durable facts with kind (`operational_lesson` `seasonal_lesson` `vendor` `local_insight` `unwritten_rule` `owner_context`), source (owner-stated via Echo chat/voice — Hermes already classifies intents, so "remember that we close the last week of December" becomes a memory write), confidence=`verified` when owner-stated, surfaced in the prompt context layer. Cheap (one table + one intent branch), and it is the moat: 12 months of accumulated business memory is the thing a competitor cannot copy by cloning features.

### W10. Competitive-advantage answer
If competitors copy every feature in two years, what survives? Not the reports. What compounds: (1) Executive Memory + decision history per brand — switching cost grows monthly; (2) outcome-labeled data → per-industry benchmarks (the consent-gated network effect from the blueprint's §20.6); (3) trust earned by visible confidence labels and honest "I don't know" — a *behavioral* moat competitors selling confidence-theater can't adopt without breaking their pitch. Strengthen: make memory visible to the owner ("what Sage knows about your business" page) so the accumulated value is *felt*, and export-locked value is honest (owner can export; the point is usefulness, not hostage-taking).

---

## Part 2 — Remove / simplify / postpone / move

| Item | Verdict | Why |
|---|---|---|
| Adapter dual-write layer | **REMOVE** | W2 — canonical write path instead |
| Numeric priority formula | **REMOVE** | W4 — transparent bucket ranking |
| Experiment Engine (P7) | **POSTPONE** until outcome coverage >50% AND 6 months history | Small brands can't power tests; shipping it early produces pseudo-science with thresholds |
| Industry Playbooks (P7) | **POSTPONE** (same gate) + seed later from real cross-brand aggregates, not web research | Web-researched playbooks = confidently generic advice, the exact failure the directive forbids |
| AI commentary on channel scorecards | **REMOVE from v1 of scorecards** | Deterministic numbers first; narration adds cost, not information |
| Full Strategy Engine table zoo | **SIMPLIFY** | Start with one "Top 3 bets" strategy object + budget line; grow lifecycle states only when owners actually use it |
| 12 named intelligence systems | **SIMPLIFY (naming)** | They are categories on one store + views (blueprint already said this); never present 12 "systems" to customers — it's one Sage |
| Quarterly truth regeneration + strategy review as separate jobs | **MERGE** into the weekly synthesis with quarterly-conditional branches | Fewer jobs (W7) |
| Customer Intelligence weekly (existing) | **MOVE into Sage** | Department boundary: it's intelligence. One narrative (W6) |
| Atlas auto-optimization | **STAYS in Atlas** | Execution-time tactics. Sage sets budget strategy via directives; Atlas moves ad-set money. Boundary documented |
| Vision / brand-consistency auditing | **STAYS out of scope** (blueprint already deferred) | Confirmed correct |
| Macro-economy monitoring | **STAYS rejected** | Confirmed correct |

## Part 3 — Features to ADD (from this review)
1. **Change Diagnostics engine** (W9.1) — core plan, new Phase.
2. **Executive Debate** on significant strategy items (W9.2).
3. **Executive Memory** (W9.3).
4. **Job-queue claim table** for horizontal headroom (W7).
5. **Ingestion redaction + sensitive flag** (W8).
6. **Data-quality sentry** — nightly deterministic checks: conflicting active items (auto-set `conflict_of`, surface both), expired-but-referenced facts, staleness of Company Truth vs recent changes, coverage gaps → these become the "request missing data" nudges. (The directive's Data Quality section had storage but no *detection*; this closes it.)
7. **"What Sage knows" page** — renders truth + memory + active facts with confidence labels; the trust product surface (W10).

---

## Part 4 — REVISED phase plan

| Phase | Contents | Gate to proceed |
|---|---|---|
| **P1** | Truth consumption everywhere + flying-blind nudge + ROI "estimated" labels + **one-weekly-output consolidation (absorb Customer Intelligence)** | — |
| **P2** | Canonical `sage_intel_items` (feed becomes a view; junction tables; redaction; data-quality sentry) + job-queue claim table + input-hash skip gates on ALL AI jobs incl. existing deep cycle | — |
| **P3** | Outcome capture + attribution fields + coverage displays | runs parallel to P2 |
| **P4** | Offers + constraints + Company Truth v2 inputs + **Executive Memory** | P2 |
| **P5** | Opportunity queue (bucket-ranked, 3-decisions-weekly) + Directive Bus + decisions table + **Change Diagnostics** + "What Sage knows" page | P2–P4 |
| **P6** | Deterministic channel scorecards + honest forecasts + **Executive Debate** + Top-3-bets strategy object + self-eval scorecard | P3, P5 |
| **P7 (gated)** | Experiment Engine + Playbooks (from real aggregates) | outcome coverage >50%, 6 mo history, P6 adoption evidence |

Program-level success metric unchanged: **outcome-capture adoption**. If coverage <30% after two months of P3, everything below P5 pauses and capture UX gets rebuilt first.

## Part 5 — Cost & customer-experience concerns (consolidated)
- Corrected baseline (W1): V2 steady-state adds ~20–25% to per-brand Sage AI cost; the skip-gates likely claw most of it back by eliminating unchanged-input deep cycles. Cost per approved recommendation becomes the tracked efficiency metric from P5.
- CX: one weekly Sage moment, max 3 decisions, visible confidence labels, honest "insufficient data" states, and a single coherent narrative. The biggest CX risk was five conflicting Monday reports — resolved by the one-output rule.

## Part 6 — "If I had one more month"

**Essential (would do with real money on the line):**
1. Prototype outcome-capture UX with 3–5 real beta customers *before* building anything past P3 — the whole program bets on this behavior.
2. Build Change Diagnostics against 6 months of existing `analytics` history now — it needs no new data and delivers the "why" answer immediately; arguably it should be P1.5.
3. Load-test the daily AI stack at simulated 500 brands to get a real ceiling number instead of my estimate.

**Nice-to-have (genuinely optional):**
4. Cross-brand anonymized benchmark aggregates (consent + k≥10) — the long-term moat, but premature below ~100 brands per industry.
5. Owner-facing "ask Sage anything" analytical Q&A over intel items + diagnostics (RAG-style) — high wow, moderate cost, after P5.
6. Voice-first weekly decision session (Echo reads the 3 decisions, owner approves by voice) — natural fit with existing voice engine, pure polish.

---

## Verdict

The V1-audit-grounded direction survives review: shared evidence store, outcome capture as linchpin, opportunity→directive→result loop, honesty invariants, additive/flag-gated rollout. **Five parts of the original blueprint do not survive:** the adapter dual-write layer, the array-column schema, the numeric priority score, ungated Experiments/Playbooks, and the stale cost baseline. The revised plan above replaces them, adds the three CEO-grade capabilities the original missed (Change Diagnostics, Executive Debate, Executive Memory), enforces one weekly customer-facing narrative, and buys scale headroom to ~1k brands for about a day of queue-table work.

**This revised architecture — not the original blueprint — is what I recommend you approve, Sir.** Phase 1 remains safe to start immediately and is unchanged in substance.
