# Sage V2 — Phase 4 Architecture Review (Milestone 4)

**Stage: architecture review only. No implementation has begun.**
Blueprint of record: `SAGE_V2_CHALLENGE_REVIEW.md` (revised phase plan, Part 4)
+ `SAGE_V2_ARCHITECTURE.md` §3 (Company Truth v2), §10 (Offers), §11
(Constraints), and W9.3 (Executive Memory). Gate: Phase 2 — **satisfied**
(Milestone 2 approved July 17, 2026).

## 1. Approved scope (verified against the blueprint)

Phase 4 = four deliverables, all dark behind flags until approved:

**4A. Offer Intelligence — `sage_offers` registry (§10).**
Brand-scoped table: name · type (`discount` `financing` `guarantee` `bundle`
`lead_magnet` `urgency`) · terms · margin_note (owner-entered, never
AI-inferred) · active period (starts_at/ends_at) · status. Owner-managed UI
card in the Sage tab. Active offers become a line in the Layer-1 prompt
context (Company Truth digest + offers + constraints) so drafting agents stop
relying on "offers live only in prose." Competitor-offer observations remain
intel items (Phase 2 store) — NOT rows in this registry.

*Deferred within 4A (report-before-change):* "performance (leads/outcomes
attributed via campaign links)" — attribution needs the deterministic
campaign-source wiring flagged as future work in Phase 3 (§6 known
limitations). The registry ships with a nullable `campaign_id` link column so
the schema is ready, but no performance rollup is computed in P4. Computing it
now would either fabricate attribution or double-build Phase 5's
decision/directive links.

**4B. Business constraints — `brand_constraints` (§11).**
One row per brand, structured columns: `monthly_budget_cents` · `staff_count`
· `weekly_capacity` · `blackout_dates` (daterange[]) · `legal_notes` ·
`cash_flow_note`. Service area stays in existing `geo_targeting` (no
duplication); owner preferences stay in existing `echo_learnings` (no
duplication). Owner-entered only — NULL means "not provided," never a
default. In P4, constraints are **captured and injected as prompt context
only**. The blueprint's two code-level enforcement points (Opportunity
Synthesis post-validation, Atlas directive budget clamps) belong to Phase 5's
opportunity/directive machinery, which does not exist yet — enforcing at
nonexistent choke points is impossible; wiring premature enforcement into
today's autopilot flows would be Phase 5 scope creep. The clamp helper ships
pure + unit-tested in P4 so P5 consumes it, not reinvents it.

**4C. Company Truth v2 expanded inputs (§3b).**
Additive sources for `gatherCompanyData` (`utils/companyTruth.js`), each
honest about absence:
- **Social/online presence URLs:** new nullable `brands` columns —
  `instagram_url`, `linkedin_url`, `youtube_url`, `tiktok_url`,
  `google_business_url` — extending migration 115's pattern
  (`website_url`, `facebook_page_url`). Editable in the existing
  BusinessLinksCard (Sage tab) + Guided Setup business-profile step. Same
  normalize/validate pattern as `normalizeWebsiteUrl` (garbage rejected,
  blank clears).
- **Active offers** from 4A's registry.
- **Constraints** from 4B (summarized; margin/cash-flow notes are
  owner-visible-only context, never quoted into customer-facing copy — prompt
  rule + test).
- **Structured owner fields:** FAQs, sales process, personas — owner-entered
  (Sage tab card), AI-drafted-then-owner-approved allowed, never silently
  AI-written.
- **Customer objections:** monthly aggregation over closed autonomous
  conversations (Hermes already classifies intent per message) → written as
  intel items (Phase 2 canonical store), summarized into the truth gather.
  Aggregates only — never raw customer PII into the report (redaction rule
  from Phase 2 applies).
- **Internal CRM aggregates:** counts/outcome summaries from
  leads/appointments (Phase 3 outcome columns) — summaries only, no raw PII.
- *Not feasible, per blueprint:* video understanding — stays flagged out.
- §3c truth freshness (quarterly regeneration proposal) is **not** P4 — it is
  not listed in the P4 row and touches the approval lifecycle; deferring.

**4D. Executive Memory — `sage_memory` (W9.3).**
Brand-scoped durable business facts: `kind` (`operational_lesson`
`seasonal_lesson` `vendor` `local_insight` `unwritten_rule` `owner_context`)
· `content` · `source` (`owner_chat` `owner_voice`) · `confidence`
(`verified` when owner-stated — the only source in P4, so all rows are
verified) · `status` (`active` `archived`). Capture path: a "remember this"
intent branch in the Echo orchestration (Hermes decide() already returns
`agent`/`intent`; Echo owns memory per the teammate contract). Writes are
**confirmation-gated**: Echo restates the fact and confirms before persisting
(same MANDATORY-marker + server-side-append pattern as feature-suggestion
capture — the "noted" confirmation only after the DB write succeeds).
Injection: active memories join the Layer-1/3 context through the existing
`withTruthSystem` chokepoint alongside learnings. Owner can list/archive
memories (Sage tab card); the full "What Sage knows" page is Phase 5.
Distinction from existing stores (verified in code): `echo_learnings` =
distilled *marketing style* preferences; `echo_memory` = conversational
events; `sage_memory` = durable *business facts*. No migration of existing
rows; no overlap.

## 2. Dependencies from earlier milestones (verified in code)

- Phase 2 gate satisfied: `sage_intel_items` canonical store + dedup contract
  (`models/117_sage_v2_phase2.sql`), job queue + skip gates — objections
  mining rides these.
- `utils/companyContext.js` digest (2400-char cap, 15-min cache) injected via
  `withTruthSystem` in `config/anthropic.js` — the single chokepoint P4
  extends for offers/constraints/memory context. Digest priority order must
  keep truth first; new context is size-budgeted so the cap isn't silently
  blown (see risk #2).
- Phase 3 outcome columns exist for CRM aggregates; coverage denominator rule
  (P3 §6.1) is untouched.
- Flags infra: `config/aiControls.js` `getSwitch` (DB > env > code default).
- Hermes decide() (`config/hermes.js` + `utils/echoOrchestrator.js`) fails
  closed to null — memory capture inherits that (no Hermes → no memory
  writes, chips-style honesty: Echo says it can't record right now).

## 3. Feature flags (new, all default OFF)

- `SAGE_V2_OFFERS` — offers table writes, endpoints, UI card, prompt injection
- `SAGE_V2_CONSTRAINTS` — constraints capture, endpoints, UI card, prompt injection
- `SAGE_V2_TRUTH_INPUTS` — expanded gatherCompanyData sources + objections mining job
- `SAGE_V2_EXEC_MEMORY` — memory intent branch, table writes, endpoints, injection

Flag-dark = byte-identical: new endpoints answer `{enabled:false}`; existing
responses unchanged; `withTruthSystem` output unchanged; no background jobs
run. (House rule from Phases 1–3.)

## 4. Risks & conflicts identified (report-before-change items)

1. **Enforcement-point mismatch (resolved by deferral, needs sign-off).** §11
   says constraints are "enforced at two points" — both are Phase 5 surfaces.
   P4 ships capture + context + a pure, tested clamp helper; enforcement wiring
   lands in P5. Alternative (wiring clamps into today's autopilot budget flow)
   is possible but is undeniably P5-flavored behavior change; not recommended.
2. **Context-budget pressure.** Adding offers/constraints/memory to a
   2400-char digest can evict truth sections. Design: fixed sub-budgets
   (truth keeps priority; offers/constraints/memory get bounded tails) +
   a unit test asserting truth content survives worst-case injection.
3. **Sensitive fields in prompts.** `margin_note`, `cash_flow_note`,
   `legal_notes` are owner-private. Rule: they inform *feasibility* context
   for internal reasoning surfaces only and are excluded from any
   customer-facing drafting prompt (chatbot, autonomous replies, ad copy).
   Enforced by builder-level exclusion + test, not prompt hope.
4. **Memory write authority.** Only the owner's own statements create
   memories (owner-only routes, confirmation-gated); AI never self-writes a
   "fact." Kind/content validated; garbage rejected with 400.
5. **Objections mining cost/PII.** Monthly, per-brand, skip-gated (Phase 2
   input-hash gates), aggregates only, demo brands excluded (house rule).
6. **No Phase 5/6 leakage.** No opportunity queue, no directives, no "What
   Sage knows" page, no forecasts, no debate. The only forward-looking
   artifacts are nullable link columns and the pure clamp helper.

**No architectural conflicts with the approved Sage V2 architecture were
found.** The Phase 2 canonical-source rule and Phase 3 measurement-only rule
are unaffected: offers/constraints/memory are owner-stated operational data,
not intelligence items, and nothing consumes `leads.outcome` for
recommendations.

## 5. Verification plan

- Migration 119 additive + idempotent (three tables + five brand columns);
  flags-off parity tests (no writes, no response-shape change, digest
  byte-identical).
- Unit/integration: offer CRUD + ownership guards + active-period logic;
  constraints NULL-honesty (no defaults fabricated); clamp helper exhaustive
  pure tests; digest sub-budget/truth-priority test; sensitive-field
  exclusion test; memory intent parse fail-closed + confirmation-gated write +
  owner-only + archive; objections mining aggregates-only + skip-gate + demo
  exclusion; foreign-brand 404s on every new endpoint.
- Full suite + client tests + client build; architect self-review; completion
  report. Validation gates remain `test`, `client-test`, `client-build`.
