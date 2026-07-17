# ZORECHO SAGE V2 — MASTER ARCHITECTURE BLUEPRINT
**Phase 1 deliverable — architecture only. No code has been written.**
**Date:** July 17, 2026 · Grounded in the July 17 code audit (`SAGE_DEPARTMENT_AUDIT.md`). Every reference to existing behavior cites real files/tables. Anything infeasible with today's APIs is flagged honestly rather than designed around.

---

## 0. Executive summary

Sage V1 is a trustworthy researcher and reporter. Sage V2 turns it into a closed-loop Chief Strategy Officer by adding **six missing layers on top of what already works**:

1. A **shared intelligence schema** (one findings store all systems write to and read from)
2. **Outcome capture** (deal value, close status, recommendation tracking — the data that makes measurement and learning possible)
3. An **Opportunity Engine** (evidence → ranked, structured, approval-gated work directed to departments)
4. A **Strategy Engine** (living plan with lifecycle states, not expiring prose)
5. An **Experiment Engine** (controlled tests with thresholds and recorded decisions)
6. A **Decision Review loop** (every recommendation permanently tracked from approval through measured result to learning)

We **keep** everything the audit scored well: Company Truth lifecycle, citation enforcement, the confirmed-competitor model, Pattern Intelligence honesty, Vision/Forge division, the claim-ledger/dedup/fail-closed engineering, and the approval-gate discipline.

The single most important architectural decision in this document: **everything flows through one table family (`sage_intel_items` + `sage_opportunities` + `sage_decisions`) instead of per-feature prose tables.** That is what makes cross-system pattern analysis, learning, cost-per-insight measurement, and "Sage never forgets" possible.

### Honest feasibility limits (read first)

These items in the directive **cannot be built as imagined with today's architecture or APIs**. Alternatives are proposed inline:

| Directive item | Why it's limited | What we build instead |
|---|---|---|
| Google Business Profile, search trends, Google LSA data | GBP API requires Google OAuth scopes we don't request; Google integration is currently env-disabled; there is no free search-trends API with terms permitting this use | Company Truth records GBP URL + web_search-visible facts; search-trend claims allowed only with a web citation. Structured GBP ingestion becomes possible only after Google OAuth is re-enabled and scopes expanded (flagged as a dependency, not designed in) |
| Competitor pricing/review velocity/hiring as structured feeds | No API exposes competitor pricing or review counts over time; scraping review platforms violates their ToS | Site Monitor diffs (already built) + web_search snapshots stored as intel items with `confidence` and `evidence_url`. Velocity = diffs between our own dated snapshots — honest but sparse |
| Economy/interest-rate/weather feeds | Feasible via free APIs (FRED, NWS) but low value-per-cost for local service businesses | Deferred; market intelligence cites them via web_search when relevant. Revisit only if playbooks show demand |
| Revenue, gross profit, CAC, LTV, customer profitability | **The platform has no revenue data.** Nothing can compute profit without the owner (or an integration) supplying deal values | **Outcome capture is the linchpin of V2** (§6). Every financial metric is gated on it and displays "insufficient data" until real values exist. No estimates dressed as measurements |
| Salesperson performance | Only meaningful for brands using Team & CRM features; sample sizes tiny | Built as a view over existing lead-assignment + outcome data, clearly labeled with sample size |
| Statistical experiment rigor for small businesses | A local business generating 30 leads/month cannot power a significant A/B test in a week | Experiment Engine enforces **minimum-detectable-effect + duration honesty**: it computes required sample size and refuses to declare winners early ("directional result only") |

---

## 1. System architecture

Layered pipeline (each layer only reads from the layers above; results flow back up through the Decision Review loop):

```
L0  Evidence Layer          web_search / web_fetch / Meta Ad Library / internal DB / owner input
L1  Company Truth v2        approved, versioned, consumed by EVERY department (enforced)
L2  Intelligence Systems    12 collectors writing structured sage_intel_items
L3  Pattern Intelligence v2 cross-source analysis over intel items + performance + outcomes
L4  Opportunity Engine      ranked, structured, evidence-linked opportunities
L5  Strategy Engine         living strategy objects with lifecycle states
L6  Owner Approval          existing approval UX, extended to opportunities/strategy/experiments
L7  Directive Bus           structured handoffs to Nova/Atlas/Forge/Pulse/Voice + status tracking
L8  Performance Intelligence funnel + financial measurement (real data only)
L9  Decision Review          measured result → lessons → sage_learnings → future prompts
```

**Runtime model:** unchanged — Node/Express CommonJS, cron-style jobs in `utils/scheduler.js`, atomic per-brand claims via `sage_research_runs` pattern (extended with new `cycle_type` values), Anthropic via `config/anthropic.js` `createMessage` (timeout/retry/pause_turn already hardened), Hermes for cheap classification. **No new services, no queues, no infra change.** Events are DB rows + the existing notification/voice pipes, not a message broker (§7).

---

## 2. Shared intelligence schema (the backbone)

### `sage_intel_items` (new; migration `1xx_sage_intel_items.sql`)

Every finding from every collector becomes one row. Existing tables (`sage_intelligence_feed`, `competitor_ads`, `competitor_website_changes`, etc.) remain as raw stores; a thin adapter writes/updates the normalized item.

| Column | Type | Notes |
|---|---|---|
| item_id | uuid PK | |
| brand_id | uuid FK brands | every item is business-specific |
| category | text | `company` `market` `competitor` `customer` `channel` `offer` `brand` `reputation` `geo` `sales` `financial` `operational` |
| source_type | text | `web_search` `web_fetch` `meta_ad_library` `site_monitor` `internal_db` `owner_submitted` `department_result` |
| source_ref | text | URL, table+id, or ad archive id |
| evidence_excerpt | text | verbatim grounding text (required) |
| summary | text | one-paragraph finding |
| why_it_matters | text | business-specific relevance |
| confidence | text | `verified` (primary source / owner-confirmed) · `reported` (single credible citation) · `inferred` (AI synthesis) — **AI may never emit `verified`** |
| geo_scope | jsonb null | states/counties if geographically bounded |
| discovered_at / expires_at | timestamptz | expiry mandatory per category (market 30d, competitor-ad 90d, company facts until superseded) |
| conflict_of | uuid null | points at the item this contradicts; both surfaced to owner |
| status | text | `active` `expired` `dismissed` `superseded` `promoted` (became an opportunity) |
| signal_key / content_key | text | reuse V1's proven dual-key dedup (`101/102` migrations) |
| owner_verified_at | timestamptz null | owner can mark a fact confirmed → confidence becomes `verified` |

Partial unique index on `(brand_id, content_key) WHERE status='active'` (same pattern as the current feed). All readers filter `status='active' AND (expires_at IS NULL OR expires_at > now())`.

**This one table satisfies the Data Quality section of the directive** (source, evidence, date, freshness, confidence, approval, conflict, expiration, owner verification) and is what Pattern Intelligence v2, the Opportunity Engine, and cost-per-insight accounting all read.

---

## 3. Company Truth v2

Keep the entire V1 lifecycle (`company_truth_reports`, versioning, `generating→pending_approval→approved→superseded→failed`, edit_log, missingInformation honesty). Changes:

**3a. Enforced consumption (the #1 audit finding — ships first, before anything else).**
- New helper `utils/companyContext.js` → `companyContextForBrand(brandId)`: returns a compact (~600-token, cached 15 min in-memory per brand) digest of the approved truth + top learnings.
- Injected into the system prompt of **every** brand-scoped AI generation: Nova (social/content-calendar), Atlas (campaign/ad copy), Forge (creative briefs), Pulse/Autonomous Conversations, Voice scripts, Echo chat, Email Assistant drafting. One choke point each — these all already assemble prompt context, so this is additive, not a rewrite.
- If no approved truth exists → inject nothing + increment a per-brand "flying blind" counter surfaced on the Sage page and in Echo's nudges (reuses the guided-setup nag pattern: exactly one nag at a time).

**3b. Expanded inputs** added to `gatherCompanyData` (`utils/companyTruth.js`), all from data that exists or can exist:

| New input | Source | Feasibility |
|---|---|---|
| Instagram/LinkedIn/YouTube/TikTok/GBP URLs | new nullable columns on `brands` (owner-entered in Guided Setup + Sage tab) → web_search-grounded | Full |
| Financing/promotions/current offers | new `sage_offers` table (§10) | Full |
| FAQs, sales process, customer journey, personas | owner-entered structured fields (Setup Agent conversation already captures prose; add extraction step) + AI-drafted → owner-approved | Full |
| Customer objections | mined from autonomous-conversation history (Hermes already classifies intent per message) — aggregated monthly into intel items | Full |
| CRM/call/email/appointment history | internal DB aggregates (counts, outcomes, themes) — **summaries, never raw PII, into the truth report** | Full |
| Revenue/goals/capacity | outcome capture (§6) + existing `target_goals` + new capacity fields (§11 constraints) | Gated on owner input |
| Uploaded documents/videos | documents: existing Intelligence Input PDF path; store extracted summary as intel items; video: **not feasible** (no video-understanding pipeline) — flagged | Partial |

**3c. Truth freshness.** Quarterly auto-regeneration proposal (not auto-approval): Sage drafts vNext, diffs it against approved, and presents "here's what changed in your business" for one-click approval. Never silently updates.

---

## 4. The 12 intelligence systems — mapping, not duplication

Principle: **a system = a collector writing intel items + a view**, not 12 new engines. Nine map onto existing code; three are new collectors.

| System | Backing | New work |
|---|---|---|
| Company | Company Truth v2 | §3 |
| Market | existing deep cycle (`runDeepCycleForBrand`) | adapter → intel items; add per-item relevance feedback (owner 👍/👎 stored, fed to next prompt) |
| Competitor | Competitor Watch + Ad Spy + Site Monitor (all built) | adapter → intel items; merge Site Monitor + Ad Spy scheduling under one competitor pipeline (audit §29 merge) |
| Customer | Customer Intelligence weekly + **new objection/lost-reason mining** from conversations & feedback | conversation-mining job (monthly, cheap Hermes classification pass over recent closed conversations) |
| Channel | **new**: deterministic per-channel scorecard (spend, leads, cost/lead, reply rates from existing tables) + AI commentary | one view + one small prompt; channels without data show "not connected / no data", never estimates |
| Offer | **new** `sage_offers` registry (§10) | new table + UI card |
| Brand | Vision knowledge + Company Truth voice/values | consistency checks deferred (low value/cost ratio) — **not in V2 scope** |
| Reputation | existing reputation + feedback subsystems | adapter → intel items (review themes, rating trend) |
| Geographic | geo_targeting + lead geo (leads store location where captured) | per-region lead/outcome rollup view; expansion analysis only when outcome data exists |
| Sales | Pulse/lead lifecycle + appointments + outcome capture | response-time, quote-delay, no-show aggregates → intel items |
| Financial | outcome capture (§6) | ROI v2: real where data exists, clearly-labeled estimate elsewhere |
| Operational | capacity constraints (§11) + Sentinel health | Sentinel failures already feed self-review; add capacity-vs-lead-volume check |

---

## 5. Pattern Intelligence v2

Keep the external Meta-Ad-Library craft study (honest, working). Add a second weekly pass — **Internal Pattern Study** — that analyzes *our own* evidence:

- **Inputs:** `sage_intel_items` (all categories), `analytics` weekly rows, `sage_decisions` outcomes (§9), lead/appointment/outcome funnels, offer registry, geo rollups, seasonality (same-week-last-year from our own `analytics` history).
- **Looks for:** winning/losing hooks (our creatives × performance), creative fatigue (CTR decay per creative age — computable from FB insights we already fetch), channel combinations, funnel drop-offs, response-time effects, geographic differences, offer performance.
- **Causation honesty (directive requirement):** the prompt must label every pattern `observational`; any pattern with actionable spend implications generates an **experiment proposal** (§8), never a direct "this causes that" claim. Deterministic pre-aggregation computes the numbers; the model only interprets — same architecture that keeps V1's PIE honest.
- **Output:** intel items (category per pattern) + experiment proposals + inputs to the Opportunity Engine.
- **Minimum-data guards:** each analysis declares its floor (e.g., creative fatigue needs ≥14 days × ≥1k impressions per creative). Below floor → "not enough data yet", stored as a `missing_data` note, zero AI spend.

---

## 6. Outcome capture (the linchpin)

Without revenue/close data, Financial Intelligence, real ROI, attribution, forecasting, and experiment results are all fiction. V2 makes capture nearly free for the owner:

- **Schema:** `leads` gains `outcome` (`won` `lost` `no_show` `unqualified` null), `outcome_reason` text, `deal_value_cents` bigint null, `outcome_at`, `outcome_source` (`owner` `voice` `crm` `assumed_from_appointment`).
- **Capture paths (all existing surfaces, no new UI paradigm):**
  1. Pulse/CRM lead card: two-tap "Won — $X / Lost — why?" chips.
  2. Voice: Echo asks during the morning briefing about stale hot leads that had appointments ("Did the Hendersons move forward?") — reuses the existing briefing + assistant task machinery; answer parsed by Hermes into the outcome fields.
  3. Autonomous Conversations already detect `convert` — that sets `outcome='won'` pending value.
- **Honesty rule:** metrics computed from outcomes always display coverage: "based on the 62% of leads with recorded outcomes." Below 30% coverage, financial views show the coverage prompt instead of numbers.
- **Attribution v2 (proportionate, not mythical multi-touch):** every lead already has a creation source; add `campaign_id` + `first_touch` + `converting_touch` (the conversation/channel that produced book/convert — Autonomous Conversations know this). That's three fields, populated by existing code paths, giving campaign-level profit: `sum(deal_value) per campaign - spend`. Multi-touch modeling is **explicitly rejected** — sample sizes make it pseudo-science at this scale.

---

## 7. Opportunity Engine, Strategy Engine, Directive Bus

### `sage_opportunities`
brand_id · title · thesis · **evidence_item_ids uuid[]** (≥1 required — no evidence, no opportunity) · confidence (inherited = min of evidence) · expected_impact (`revenue_estimate_cents` null + `impact_basis` text — estimate must state its basis or stay null) · cost_estimate_cents · effort (`s/m/l`) · risk text · priority score (deterministic formula: impact×confidence÷(cost+effort), recomputed nightly, ties broken by expiry) · recommended_department (`nova|atlas|forge|pulse|voice|owner`) · dependencies uuid[] · success_metric + failure_metric (machine-checkable where possible: metric name + threshold + window) · expires_at · status lifecycle: `proposed → approved | declined | expired` → `directed → in_progress → executed → measuring → succeeded | failed | inconclusive` · owner_decision_note · measured_result jsonb · lesson text.

Generated by a weekly Opportunity Synthesis job (reads intel items + patterns + channel scorecards; hard cap: **max 5 open proposals per brand** — scarcity forces quality and prevents recommendation spam). Owner approves/declines in a new Sage "Opportunities" tab + via the existing approval-queue UX pattern (Autopilot's approve/decline/revise machinery, reused).

### Strategy Engine — `sage_strategy_items`
type (`annual_goal` `quarterly_priority` `monthly_campaign_theme` `budget_allocation` `channel_mix` `positioning` `risk`) · content jsonb · evidence_item_ids · status (`draft → approved → active → completed | retired`) · review_at. Sage **drafts**, owner approves; quarterly review job diffs plan vs. measured reality and proposes amendments. Weekly priorities = the top approved opportunities — the strategy layer *is* the opportunity queue plus the standing plan, not a separate report generator.

### Directive Bus — `sage_directives`
The structured cross-department handoff the directive demands: opportunity_id FK · department · instruction jsonb (department-specific schema: e.g., for Nova `{theme, cadence, hooks[]}`, for Atlas `{budget_cents, audience, geo, creative_brief_ref}`) · status (`issued → acknowledged → done | failed`) · result jsonb (department writes back: what was created, ids, initial metrics).
**Execution departments consume directives through their existing entry points** (autopilot batch generation, campaign creation, content calendar) — Sage never bypasses their approval flows. Department completion handlers write `result` back; a nightly job joins directives × performance to fill `measured_result` on the parent opportunity. **This is the "every department reports back" requirement — implemented as rows, not a message bus, because everything is one process + one database.**

---

## 8. Experiment Engine — `sage_experiments`
hypothesis · reason · variable · control_description · audience · budget_cents · starts_at/ends_at · success_threshold + failure_threshold (metric, value, direction) · min_sample (computed at creation from baseline rates; if unreachable in the window → experiment is created as `directional` class, and its result can never be labeled a "winner", only "directional evidence") · owner approval required to start · linked directive(s) · result jsonb · decision (`adopt` `reject` `rerun` `inconclusive`) · learning text (required at close).
Sources: Pattern Intelligence proposals + opportunity engine + owner-initiated. Measurement job evaluates thresholds at end date from real metrics; **no early winner calls**. Results become intel items (`confidence='verified'` — it's our own measured data) and feed Decision Review.

---

## 9. Decision Review & learning loop — `sage_decisions`
One row per owner decision on anything Sage proposed (opportunity, experiment, strategy item, urgent alert action): subject type+id · decided (`approved/declined/revised`) · executed bool · measured_result jsonb · outcome (`worked/failed/unknown`) · why text · lesson text · feeds `sage_learnings` (extends the proven `echo_learnings` pattern — distilled weekly by the same Monday study machinery, injected into Opportunity Synthesis and strategy prompts via `learningContextForBrand`-style helper).
**Self-evaluation (directive §Self-Evaluation):** monthly deterministic scorecard per brand — approval rate, execution rate, success rate of executed recommendations, prediction error (estimated vs measured impact), cost per approved recommendation (join with the AI ledger, which already tracks per-feature spend). Rendered on the admin Self-Review page; declining trends flagged with the evidence. No AI self-flattery: all numbers computed from `sage_decisions` + `ai_usage_log`.

---

## 10. Offer Intelligence — `sage_offers`
brand-scoped registry: name · type (`discount` `financing` `guarantee` `bundle` `lead_magnet` `urgency`) · terms · margin_note (owner-entered) · active period · linked campaigns/directives · performance (leads/outcomes attributed via campaign links). Competitor offers observed by Ad Spy/Site Monitor become intel items linked by category. Company Truth v2 and all drafting prompts read active offers — ending the current "offers live only in prose" state.

## 11. Business constraints — `brand_constraints`
Structured columns: monthly_budget_cents · staff_count · weekly_capacity (jobs/appointments) · service_area (existing geo_targeting) · blackout_dates · legal_notes · cash_flow_note · owner_preferences (existing learnings). **Enforced at two points:** Opportunity Synthesis prompt (cannot propose beyond capacity/budget — and post-validation rejects violations in code, not just prompt) and directive issuance (Atlas budget directives clamp to remaining monthly budget). "Never recommend marketing the business cannot fulfill" becomes a code-level guard, not a prompt hope.

## 12. Forecasting (honest, mostly deterministic)
Feasible with real value: **lead volume** (trailing 8-week average ± seasonal factor from our own year-over-year `analytics` where ≥13 months history, else "insufficient history"), **spend pacing** (current burn vs budget → exhaustion date — pure arithmetic), **AI cost** (ledger trend — pure arithmetic), **capacity strain** (forecast leads × close rate vs weekly_capacity), **creative fatigue** (CTR decay extrapolation). Every forecast row stores `assumptions jsonb` + `confidence_band` and renders them. **Rejected:** revenue forecasting below outcome-coverage 50% and 6 months history; churn modeling (customer-count scale makes it astrology). Model usage: none — forecasts are deterministic; AI only writes the plain-English explanation (cheap, optional).

## 13. Industry playbooks — `industry_playbooks`
Admin-curated (not AI-fabricated) per-industry: benchmarks (with source citations) · seasonality calendar · buying cycle · typical objections/offers · legal considerations · recommended channels · KPIs. Sage prompts receive the playbook as context labeled "industry reference — verify against this brand's own data." Bootstrapping: Sage drafts playbooks from cited web research → **admin (you) approves each one** before any customer brand consumes it. Pattern Intelligence's industry-wide ad study already feeds the "winning messaging" section. This avoids the biggest playbook failure mode: confidently generic advice.

---

## 14. Prompt architecture
Layered context assembly, one builder per generation type (existing pattern, made uniform):
```
[System: agent role + honesty invariants (never fabricate; unknown stays unknown; cite or refuse)]
[Layer 1: Company Truth digest (approved only) + active offers + constraints]
[Layer 2: relevant intel items (top-k by category, active, non-expired) — passed WITH ids so outputs can cite item_ids]
[Layer 3: learnings + decision history relevant to this task type]
[Layer 4: industry playbook extract]
[Task instructions + output JSON schema]
```
All outputs schema-validated in code (V1 pattern); any output referencing evidence must echo the item_ids it used — enabling the evidence chain and post-hoc auditing. Refusal path everywhere: **"I don't have enough verified information to answer this confidently"** + the specific missing items, rendered as a first-class UI state (not an error).

## 15. AI workflow, model routing & cost analysis
| Workload | Model | Frequency | Est. calls/brand | Notes |
|---|---|---|---|---|
| Deep market cycle | Claude + web_search | 6h (existing) | 4/day | unchanged; adapter adds no AI calls |
| Internal pattern study | Claude (no search — internal data) | weekly | 1 | new; deterministic pre-aggregation keeps tokens small |
| Opportunity synthesis | Claude | weekly | 1 | reads intel items, caps at 5 proposals |
| Objection/outcome mining | **Hermes** (cheap classification) | monthly + per-conversation-close | ~30/mo | classification only |
| Experiment eval, forecasts, priority scores, scorecards | **deterministic — zero AI** | nightly/weekly | 0 | |
| Strategy quarterly review | Claude | quarterly | 1 | |
Cost controls (directive §Cost Control): all AI calls through the existing ledger; per-brand Sage budget line inside tier budgets; **frequency gates skip runs when inputs unchanged** (hash of intel-item set → skip synthesis if identical to last run — the biggest saving); dedup via content keys; value tracking = cost per approved recommendation (§9). Net new steady-state cost per active brand: **~5–8 Claude calls + ~30 Hermes calls per month** — small relative to the existing 6-hour deep cycle (~120 Claude calls/month), which we keep but make skippable on unchanged inputs too.

## 16. Failure, security, safety
- **Failure:** every new job uses the existing claim-ledger + per-iteration sweep-guard + stale-claim rescue patterns (audit-proven). AI failure → 502, run marked failed, no partial writes (transactions). Missing data → explicit `missing_data` states, never estimates.
- **Safety (directive §Safety):** Sage V2 adds **zero new autonomous authority**. The only autonomous V1 action (geo exclusions) is preserved. Opportunities/experiments/strategy/directives are all owner-approval-gated; directives inherit stop conditions from their opportunity (failure_metric breach → directive auto-paused + owner notified); full audit trail = the decision/directive rows themselves; owner override = decline/pause anywhere.
- **Security:** no new external ingress; owner-submitted URLs continue through existing SSRF allowlists; deal values are sensitive → owner-only visibility (same guard as Echo Email/Assistant owner-only pattern); intel items contain no raw PII (conversation mining stores themes, not transcripts); admin-only playbook editing.

## 17. Feature flags, migration, rollback
- Flags (env + admin AI-controls, mirroring `SAGE_RESEARCH_ENABLED`): `SAGE_V2_CONTEXT` (truth injection), `SAGE_V2_INTEL_STORE`, `SAGE_V2_OUTCOMES`, `SAGE_V2_OPPORTUNITIES`, `SAGE_V2_EXPERIMENTS`, `SAGE_V2_FORECASTS`. Each independently disableable; UI tabs hide when off.
- Migrations: additive only (new tables + nullable columns on `leads`/`brands`) — **zero destructive changes, so rollback = flag off**; tables remain dormant. Existing V1 tables untouched; adapters are one-way (V1 → intel items), so V1 keeps working standalone throughout.
- Data backfill: adapters replay the last 90 days of feed/ad/site-change rows into intel items on first enable (idempotent via content keys).

## 18. Testing strategy
Per-subsystem node:test suites following house patterns (dbGuard preload, pooled-client rules): schema validation of every AI output shape; deterministic engines (priority scoring, forecasts, experiment thresholds, constraint clamps) get exhaustive unit tests — they're pure functions; claim/dedup/lifecycle concurrency tests (double-tick, double-approve) matching existing sweep tests; adapter idempotency (replay twice → no dupes); coverage-gate tests (financial views refuse below 30% outcome coverage); client vitest for new tabs; end-to-end: seeded brand walks intel → opportunity → approval → directive → result → learning. Validation gates remain `test`, `client-test`, `client-build`.

## 19. Implementation phases (each independently shippable & valuable)
| Phase | Contents | Effort | Depends on |
|---|---|---|---|
| **P1** | Truth consumption everywhere + "flying blind" nudge + ROI "estimated" labeling + Monday report consolidation | S (days) | nothing |
| **P2** | Intel item store + adapters + confidence/expiry + Sage feed reads from it | M | P1 |
| **P3** | Outcome capture (schema + Pulse chips + briefing capture + attribution fields) | M | nothing (parallel with P2) |
| **P4** | Offer registry + constraints + Company Truth v2 inputs | M | P2 |
| **P5** | Opportunity Engine + Directive Bus + decisions table + Opportunities tab | L | P2–P4 |
| **P6** | Internal Pattern Study + Channel scorecards + honest forecasts | M | P2, P3 |
| **P7** | Experiment Engine + self-evaluation scorecard + playbooks | L | P5, P6 |
Rough total: 7 phases; P1 is immediate; P5 is the transformation moment. Each phase ends with tests + architect review + your approval before the next.

---

## 20. What James hasn't asked for yet

Straight challenges to the directive, Sir — as requested, no diplomacy:

1. **The directive's biggest risk is building intelligence on data that doesn't exist.** Half the vision (financial intelligence, forecasting, experiments, profit optimization) is gated on outcome data no customer currently enters. If owners won't tap "Won — $4,500", Sage V2 is a beautiful engine with no fuel. That's why P3 (outcome capture) is scheduled before the glamorous engines, and why capture is designed into surfaces owners already touch (briefing, lead cards, conversations). **Recommendation: treat outcome-capture adoption as the #1 success metric of the entire program.** If coverage stays under 30% after two months, pause P6/P7 and fix capture UX instead.
2. **Approval fatigue is unaddressed in the vision.** V2 adds approvals for opportunities, strategy, experiments, playbooks — on top of autopilot, Company Truth, and competitor confirmations. A busy owner will start rubber-stamping or ignoring, which silently destroys the learning loop (all decisions look like "approved, never executed"). Mitigations built in: 5-opportunity cap, one weekly decision session surfaced through the existing briefing, and expiry (undecided items expire rather than pile up). Consider a future "trust level" where consistently-approved categories graduate to notify-instead-of-ask.
3. **You asked for 12 intelligence systems; you should ship views, not engines.** The failure mode of "dedicated systems" is 12 cron jobs generating 12 reports nobody reads (you already have four overlapping Monday reports — the audit flagged it). The architecture deliberately makes 9 of 12 thin adapters/views over one store. Resist future pressure to give each its own AI job.
4. **Missing from your vision: a kill-switch discipline for recommendations.** You specified stop-losses for autonomous actions, but not for *advice*. Bad advice at scale is a churn machine. The self-evaluation scorecard (§9) should gate Sage's own output: if a brand's success rate of executed recommendations falls below a floor, Sage should automatically shift to "evidence-only mode" (gather, don't advise) for that brand and say so. Added to §9 design.
5. **Missing: customer-visible confidence.** Internally we track confidence; the UI should show it. "Reported (1 source, 12 days old)" next to a finding is the single cheapest trust-builder with skeptical small-business owners — and differentiates Zorecho from every confident-hallucination competitor.
6. **Missing: a data-sharing network effect.** Anonymized, industry-level aggregates across Zorecho brands (median cost/lead for HVAC in the Southeast, seasonal curves) would make playbooks self-updating and is a moat no single-tenant competitor can copy. Requires a customer consent clause + aggregation thresholds (k≥10 brands) — a policy decision for you, so it is designed-for (intel items are aggregable) but not built.
7. **Missing: economics of YOUR business.** The directive optimizes customer profit but never asks Sage to watch Zorecho's own unit economics per feature. The ledger already has the data; the self-evaluation scorecard should include "AI cost per retained customer per feature" for you at the admin level. Cheap to add in P7.
8. **One thing in the vision I recommend rejecting outright: continuous economy monitoring (interest rates, macro).** For $100–550/month local-business customers, macro commentary is indistinguishable from a newsletter and burns tokens. Local, concrete signals (a competitor's price cut, a county development project) move their business; the Fed does not. Kept out of scope deliberately.
9. **Sage's gender/persona consistency:** the directive says "she" — current product copy is inconsistent about agent pronouns. Trivial, but customer-facing; ChatGPT (Creative Director) should rule on persona voice before P5's Opportunities tab ships new Sage copy.

---

**Awaiting your approval, Sir.** Nothing will be built until you approve this architecture (and per the operating model, any customer-facing copy in the new tabs goes through ChatGPT first). Recommended approval order if you want to start conservatively: approve P1 alone — it's days of work, zero risk, and fixes the audit's #1 finding while you consider the rest.
