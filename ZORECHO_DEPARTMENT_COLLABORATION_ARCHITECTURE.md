# Zorecho Department Collaboration Architecture

**Status:** DRAFT v2 — approved in principle by the CEO (July 19, 2026);
revised to incorporate CEO Additions 1–3 (Department Performance Scorecards,
Executive Roundtable, Collaboration Philosophy). **Awaiting final approval.
No implementation has begun — Stage 0 does not start until this revision is
approved.**
**Date:** July 19, 2026
**Scope:** System-wide. This is not a Sage phase. Sage V2 is feature complete
(bug fixes only). This document defines how every current and future
department communicates, so the platform thinks like one company instead of
ten isolated agents.

---

## 0. Design principles (inherited, non-negotiable)

Everything below is constrained by the Engineering Constitution and the
standing invariants proven through Sage V2:

1. **Honesty over impressiveness.** A department that doesn't know says so.
   No fabricated answers, no silent fallbacks. Failed AI calls → 502, never
   mocked.
2. **Nothing executes without its existing approval path.** Collaboration
   moves *information and requests*, never actions. Every department keeps
   its own approval gates, spend limits, and guardrails exactly as built.
3. **Enforcement at chokepoints, not in prompts.** The AI is asked to behave;
   the code makes it behave. Every rule in this document names its
   enforcement point.
4. **Dark by default.** Everything ships behind flags (default OFF), additive
   migrations only, byte-identical dark responses.
5. **Cost is capped structurally.** Collaboration must reduce duplicate AI
   work, not multiply it. Caps and skip gates are part of the design, not an
   afterthought.
6. **The owner is the executive.** Departments collaborate to prepare better
   work for the owner's decision — they never form a quorum that replaces it.
7. **Collaboration Philosophy (CEO Addition 3).** *Every department is
   responsible not only for performing its own responsibilities well, but
   also for improving the effectiveness of every other department whenever
   it possesses information those departments need.* Cooperation is a core
   architectural behavior, not an optional enhancement — the Collaboration
   Bus exists to make this principle cheap, auditable, and safe to practice.
   (Enforcement: the registry topics in §4 and reporting flows in §5 are the
   concrete expression of this duty; a department that owns information
   another department needs gets a topic, not an excuse.)

## 1. The company model

Zorecho already presents itself as a team. This architecture makes that real:

| Department | Role | Owns (authoritative for) |
|---|---|---|
| **Echo** | Marketing Director / Chief of Staff | Owner communication, briefings, approvals queue, reminders, email triage, task routing, the owner's attention |
| **Sage** | Executive Intelligence | Company Truth, Executive Memory, opportunities, strategy & bets, channel scorecards, forecasts, self-evaluation, learnings |
| **Scout** | Research | Competitor intel (ads, sites, pricing), market/industry intel, capital & funding, SEO/keyword research |
| **Atlas** | Advertising | Ad campaigns, ad budgets & pacing, ad creative deployment, Facebook ads account state |
| **Nova** | Social | Social calendar, post scheduling/publishing, platform connections, autopilot content batches |
| **Forge** | Creative | Brand-consistent creative assets: images, ad creative packages, video scripts, sales scripts |
| **Pulse** | CRM | Leads, outcomes, appointments, follow-up sequences, email/SMS marketing sends, sales queue |
| **Voice** | Reception | Phone calls, website chatbot conversations, raw customer language & objections |
| **Sentinel** | Oversight | Health monitoring, failure detection, connection status, anomaly alerts |
| **Vision** | Visual Intelligence | Screenshot/visual analysis capabilities offered as a service to others |

**Ownership rule:** exactly one department is authoritative for each piece of
information. Everyone else *requests* it — nobody recomputes it, caches a
stale private copy, or guesses. (Enforcement: the Knowledge Registry, §4, is
the only lookup path the collaboration layer offers.)

Two special roles:

- **Echo orchestrates** (§8): routing, sequencing, owner communication.
  Echo is a coordinator, not a super-user — Echo cannot approve on the
  owner's behalf and cannot bypass a department's gates.
- **Sage advises** (§9): every department can ask Sage "what do we know /
  what does the strategy say" — Sage answers only from its stored, validated
  intelligence, with the same honesty rules Sage V2 enforces today (approved
  Company Truth only, evidence-linked opportunities, null-not-zero).
- **Hermes remains the in-product runtime decision brain** (intent, routing,
  classification) exactly as today — fast, single-attempt, null on failure.
  Hermes is used *by* this architecture (§8) but is not changed by it.

## 2. What exists today (the foundation we generalize)

This architecture invents as little as possible. It generalizes proven
Zorecho patterns:

- **The Phase 5 Directive Bus** (`sage_directives`) already moves structured,
  validated, approval-gated handoffs from Sage → Atlas/Nova/Forge/Pulse, with
  constraint clamps, acknowledge/complete lifecycle, and measurement joins.
  It is the prototype for the Collaboration Bus (§3) — same shape, opened to
  all departments.
- **Input-hash skip gates** already prevent duplicate AI work per job. They
  become the duplicate-work prevention layer for collaboration (§10).
- **The AI-cost ledger** already tags every call with a feature and brand.
  Collaboration traffic gets its own feature tags so its cost is visible.
- **Job claiming** (`FOR UPDATE SKIP LOCKED`, advisory locks, unique-index
  backstops) is the concurrency model for bus consumers.
- **The agents roster + Department Views** are the client surface where
  collaboration becomes visible to the owner.

## 3. The Collaboration Bus

One new table, one new module, one pattern. All inter-department
communication flows through **`department_messages`** via
**`utils/collaborationBus.js`** — the single chokepoint.

### 3.1 Message shape

```
department_messages
  message_id      UUID PK
  brand_id        UUID NOT NULL → brands (CASCADE)   -- always brand-scoped
  from_dept       TEXT NOT NULL  (roster CHECK)
  to_dept         TEXT NOT NULL  (roster CHECK)
  kind            TEXT NOT NULL  CHECK IN ('request','response','report','alert')
  topic           TEXT NOT NULL  -- registry key, e.g. 'strategy.current', 'creative.request'
  payload         JSONB NOT NULL -- topic-schema-validated at the chokepoint
  correlation_id  UUID           -- responses/reports point at the request
  plan_id         UUID           -- Echo orchestration plans only (§10, Appendix A)
  status          TEXT NOT NULL DEFAULT 'sent'
                  CHECK IN ('sent','claimed','answered','declined','expired','failed')
  priority        TEXT NOT NULL DEFAULT 'routine' CHECK IN ('routine','elevated')
  answer_by       TIMESTAMPTZ    -- explicit expiry; nothing waits forever
  input_hash      TEXT           -- dedup key (§10)
  error_message   TEXT           -- honest failure reason, owner-readable
  created_at / claimed_at / answered_at TIMESTAMPTZ
```

- **`request`** — "I need information or work product from you."
- **`response`** — the answer, linked by `correlation_id`. A department that
  cannot answer responds `declined` with a plain-English reason — silence is
  not an allowed outcome (the expiry sweep enforces it, §6).
- **`report`** — unsolicited fact flow to the owning department ("Pulse →
  Sage: 12 leads got outcomes this week"). Fire-and-forget, but logged.
- **`alert`** — a fact that may need owner attention. Alerts route **only
  through Echo** (§8); departments never interrupt the owner directly.

### 3.2 Chokepoint rules (enforced in `collaborationBus.js`, not in prompts)

1. Every message is validated against the topic's registered payload schema
   before insert. Invalid → rejected at write, nothing partial stored.
2. `topic` must exist in the Knowledge Registry (§4) and `to_dept` must be
   its registered owner — you cannot ask the wrong department.
3. Every message carries `brand_id`; consumers verify brand scope on read
   (same `getOwnedBrand`-style join discipline as everywhere else).
4. Requests must set `answer_by`. Default 24h; nothing is open-ended.
5. Demo brands are excluded at the bus level (standing rule).
6. Messages are immutable once answered — the log is the audit trail (§6).

### 3.3 What the bus is NOT

- Not an execution path. A message can *ask* Atlas to consider a campaign;
  only Atlas's existing creation path (with its approvals and clamps) can
  create one.
- Not a chat between AIs. Payloads are structured JSONB against registered
  schemas — no free-form AI-to-AI conversation loops (§10 makes loops
  structurally impossible to pay for).
- Not a replacement for the Sage Directive Bus. `sage_directives` remains
  the execution-handoff record for approved opportunities; the Collaboration
  Bus handles the informational layer around it. (V2 may migrate directives
  onto the bus once it is proven; not in scope now.)

## 4. The Knowledge Registry — who owns which information

A small, code-defined registry (`config/knowledgeRegistry.js`, no DB table
needed) mapping every topic to its owner, payload schema, and answer source:

```
'strategy.current'        → sage    (approved strategy + bets, or honest "none")
'truth.company'           → sage    (approved Company Truth only, or "none approved")
'scorecard.channel'       → sage    (Phase 6 scorecards, null-not-zero)
'intel.competitor'        → scout   (stored intel items for the brand)
'creative.request'        → forge   (brief in, asset/package out — via Forge's existing paths)
'campaign.performance'    → atlas   (real campaign metrics, or "not connected")
'social.calendar'         → nova    (scheduled/published state)
'leads.outcomes'          → pulse   (Phase 3 outcome data + coverage)
'customer.language'       → voice   (aggregated objections/questions from calls & chats)
'system.health'           → sentinel (connection + failure state)
```

Registry rules:

- **One owner per topic.** Adding a topic requires naming its owner and
  schema in code review — ownership disputes are resolved at design time,
  not runtime.
- **Every topic is classified `lookup` or `generation` in the registry.**
  `lookup` topics (all of the above except `creative.request`) answer only
  from stored, validated data — zero AI cost, always. `generation` topics
  (only `creative.request` in v1) may trigger real work, but exclusively
  through the owner department's **existing** gated generation path (Forge's
  tier checks, cost ledger, and approval flow unchanged); the bus adds no
  new generation capability and the cost is ledger-tagged to the requesting
  flow's feature tag so collaboration spend is separately visible.
- **Honest empties.** Every topic schema includes an explicit
  "no data / not connected / not approved" shape. `{}` is never an answer.

## 5. When departments ask each other for help — the v1 flows

Exactly the flows the CEO named, expressed as bus traffic. Each is
independently flagged and can be enabled one at a time:

| # | Flow | Bus traffic | What changes for the owner |
|---|---|---|---|
| 1 | **Forge asks Sage before creating** | `forge → sage: strategy.current` + `truth.company` before content/creative generation | Creative briefs cite the live strategy bet they serve ("Supports Bet 1: …") — or honestly say "no strategy on file" |
| 2 | **Atlas requests intelligence before campaigns** | `atlas → scout: intel.competitor` + `atlas → sage: strategy.current` | Campaign drafts show what intel informed them, or say none existed |
| 3 | **Nova requests strategy before publishing batches** | `nova → sage: strategy.current` at autopilot/calendar batch time | Weekly batches are labeled with the bet they serve; off-strategy items flagged for the owner, never silently dropped |
| 4 | **Pulse reports results back to Sage** | `pulse → sage: leads.outcomes` report after outcome updates | Sage's self-eval and scorecards stay current without polling |
| 5 | **Voice feeds customer insights to Pulse & Sage** | `voice → pulse/sage: customer.language` weekly aggregate | "What customers actually said" appears in Sage intel and Pulse context — aggregated, PII-redacted at the chokepoint |
| 6 | **Scout continuously enriches Sage** | `scout → sage: intel.competitor` report on new confirmed intel | Already partially real (Sage intel store); becomes uniform bus traffic |

**The consultation pattern (uniform across flows 1–3):** before a department
generates work product, it requests the relevant intelligence. If the answer
arrives (or is already fresh), it is injected into the *existing* prompt
builder as labeled context. If the owner department declines or the request
expires, generation proceeds **with an honest gap note** ("Drafted without a
current strategy — none is approved for this brand") that travels with the
work product into the approval queue. **Collaboration never blocks a
department's core job** — it enriches it or honestly says it couldn't.
(Enforcement: the consuming department's prompt builder takes a
`collaborationContext` argument; the gap note is appended in code, not left
to the AI.)

## 6. How requests and responses are logged

- The `department_messages` table **is** the log — immutable, brand-scoped,
  queryable. Every request, response, decline, expiry, and failure is a row
  with timestamps and honest `error_message`s.
- **Expiry sweep:** a flag-gated branch in the existing nightly maintenance
  job (no new scheduled job) flips overdue `sent/claimed` messages to
  `expired`, iteration-guarded per the sweep-guard rule. Expired requests
  produce the gap-note path (§5) — never a hang, never a fabricated answer.
- **Owner visibility:** a "Team Collaboration" card in Mission Control (flag
  `COLLAB_ACTIVITY_VIEW`) shows recent traffic in plain language: *"Forge
  asked Sage for the current strategy → answered in 2s → used in Friday's
  ad creative."* This is the trust surface — the owner can see the company
  working.

## 7. How disagreements are handled

Departments do not negotiate. A "disagreement" is a **structured conflict
finding**, and the owner is the tiebreaker:

1. **Detection is deterministic where possible.** Example: Nova's batch
   contains an item whose declared bet doesn't match the live strategy;
   Atlas's draft budget exceeds the strategy budget line. These are code
   checks at the consuming department's chokepoint, not AI opinions.
2. **The work product is never silently altered.** The conflict is attached
   to it as a plain-English note and the item routes to the owner's existing
   approval queue with an `elevated` marker. (Same principle as Phase 6
   budget clamping: block/flag with an explanation, never silently change
   the numbers.)
3. **AI-vs-AI disagreements are not resolved by more AI.** If Sage's
   recommendation and a department's plan conflict, both positions are shown
   to the owner side-by-side with their evidence. No arbitration calls, no
   consensus loops.
4. **The owner's decision is recorded** (existing decisions/approvals
   patterns) and feeds the learning loop (§11): a repeatedly-overruled rule
   is a signal for Sage's self-review, not something the system quietly
   stops enforcing.

## 8. How Echo coordinates everyone

Echo's role grows from "owner's assistant" to **chief of staff** — routing
and sequencing, never deciding:

- **Single voice to the owner.** All `alert` traffic lands in Echo's queue.
  Echo dedups, prioritizes (existing conversation-priority queue), and
  delivers via the channels that already exist (briefing, companion, push,
  voice) under the existing permission-to-speak rules. Departments never
  interrupt the owner directly.
- **Routing.** When the owner asks for something ("get me more roofing
  leads"), Hermes classifies intent as today; Echo then issues the right
  bus requests to the right owners rather than answering from thin air —
  and tells the owner honestly who is doing what.
- **Sequencing.** For multi-department work (strategy → creative → campaign
  → posts), Echo issues requests in dependency order and holds the summary
  until parts arrive or expire. Echo reports partial completion honestly.
- **Echo's hard limits (enforced at the bus chokepoint):** Echo cannot send
  `response` messages for topics it doesn't own, cannot approve or decline
  work product, and cannot mark another department's request answered. The
  chokepoint checks `from_dept` against topic ownership for responses —
  even Echo's.

## 9. How Sage acts as executive intelligence

Sage is the most-asked department but gains **no new generation powers**
(Sage V2 is frozen):

- Sage answers bus requests **only from what Sage already stores**: approved
  Company Truth, live strategy and bets, opportunities, scorecards,
  forecasts, self-eval, executive memory, intel. All existing honesty rules
  apply unchanged (approved-only truth, null-not-zero, "insufficient" over
  invention).
- Inbound reports (Pulse outcomes, Voice language, Scout intel) flow into
  Sage's **existing** ingestion paths (intel store with redaction, outcome
  tables) — the bus is a delivery mechanism, not a new write path around
  Sage's validation.
- **Post-approval future integration (not Sage-scope drift):** once this
  architecture is approved and the bus is live (Stage 2+), Sage's weekly
  self-review would gain one new evidence source — collaboration traffic
  (who asked what, what went unanswered, which gap notes recur). "Forge
  asked for a strategy 6 times this month and there was none" is exactly
  the kind of honest, evidence-based observation the self-review exists to
  surface. This is collaboration-stage work delivered under this document's
  approval, not a reopening of the frozen Sage V2 feature set; Sage's
  generation behavior, prompts, and outputs are otherwise untouched.

## 10. How duplicate work is prevented

Three structural layers (not prompt requests):

1. **Ask, don't recompute.** The Knowledge Registry gives every piece of
   information one owner and one lookup path. Code review enforces that new
   features consume registry topics instead of re-deriving owned data.
2. **Input-hash dedup on the bus.** A request whose (brand, topic,
   payload-hash) matches one answered within the topic's freshness window
   is answered **from the logged response, free** — no consumer wake-up, no
   AI. Same proven mechanism as the existing skip gates.
3. **Hard caps and the anti-loop rule.** Per-brand daily bus-message cap
   (generous, but finite), plus a structural anti-loop rule at the
   chokepoint: **for every department except Echo, a request may not be
   created in reaction to a `response`** — request → response is one hop,
   terminal. The single, precisely-bounded exception is Echo's orchestration
   (§8): Echo may issue follow-on requests **only** as steps of a
   pre-declared finite plan — each Echo sequence is created up front with a
   `plan_id` and a fixed, ordered list of at most N steps (N ≤ 5 in v1);
   the chokepoint rejects any Echo request whose `plan_id` is missing,
   exhausted, or already past its declared step count. Plans cannot spawn
   plans. Reactive AI-to-AI conversation is therefore impossible to express
   on the bus for anyone, including Echo, at any spend level.

## 11. How every department becomes stronger by sharing

The compounding loop, stated as data flow:

```
Voice hears customers → language aggregates → Sage intel & Pulse context
Pulse measures outcomes → Sage scorecards/self-eval → sharper opportunities
Scout finds competitor moves → Sage strategy context → Atlas/Nova/Forge briefs
Sage strategy + truth → every department's work product cites the same plan
Owner approvals/overrides → decisions log → Sage self-review → better asks
```

Each arrow is a bus topic with an owner, a schema, and an honest-empty case.
Every arrow in this loop is a `lookup` topic or a report of already-computed
data — the loop itself adds **zero new recurring AI jobs**. (The only
`generation` topic, `creative.request`, is owner-flow work that would have
been generated anyway; it is not part of this loop.)

## 12. Department Performance Scorecards (CEO Addition 1)

Every department gets **deterministic weekly performance metrics** — factual
measurements computed from the department's own operational data. No AI
generates, adjusts, or interprets any number. Same discipline as the Sage
Phase 6 channel scorecards: `null` with a reason code when data doesn't
exist, never a fabricated zero; source row counts stored with every card.

**Initial metric sets (per CEO direction):**

| Dept | Metrics |
|---|---|
| **Forge** | Creative requests completed · average turnaround time · approval rate · owner revision rate · asset reuse percentage |
| **Atlas** | Campaigns created · budget accuracy · ROAS · strategy compliance · campaign success rate |
| **Nova** | Posts published · on-time publishing percentage · engagement metrics · strategy alignment · scheduling accuracy |
| **Pulse** | Follow-ups completed · average response time · appointment conversion rate · lead outcome coverage · CRM completion percentage |
| **Voice** | Calls handled · appointment booking percentage · customer satisfaction (where available) · new customer objections discovered · escalation rate |
| **Scout** | New intelligence reports created · intelligence later referenced by other departments · competitor changes detected · research turnaround time |
| **Sentinel** | Issues detected · false alarm rate · downtime prevented · connection health accuracy |
| **Vision** | Visual analyses completed · assets improved · visual recommendations adopted |
| **Echo** | Tasks coordinated · average orchestration time · owner reminders delivered · approval queue efficiency |
| **Sage** | Opportunities identified · recommendations approved · recommendation success rate · strategy accuracy · forecast accuracy (Sage's existing Phase 6 self-eval **is** this scorecard — reused, not rebuilt) |

**Rules:**

- **Deterministic only.** Every metric is a SQL aggregate over rows the
  department already writes (posts, campaigns, calls, directives, bus
  messages). Metrics whose source data doesn't exist yet for a brand
  (e.g. Voice satisfaction without a survey source, "downtime prevented"
  without an incident baseline) report `null` + reason code
  (`no_data_source`) until the source exists — stated honestly in the UI,
  never estimated.
- **Denominators always stated** (approval rate = approved of N submitted),
  per the Phase 6 convention.
- **For continuous improvement, not autonomous action.** Scorecards are
  displayed to the owner and available to Sage's self-review as evidence.
  No code path ranks departments against each other, reallocates work,
  changes budgets, or triggers any action from a scorecard. They measure;
  the owner decides.
- **Mechanics:** one `department_scorecards` cache table (brand, dept, week,
  metrics JSONB, source_row_counts), computed by a flag-gated branch of the
  existing nightly maintenance job (`COLLAB_DEPT_SCORECARDS`, OFF), surfaced
  on each Department View. Zero AI cost.

## 13. Executive Roundtable (CEO Addition 2)

A **structured collaboration pattern — not AI agents freely conversing.**
When the owner asks a major strategic question ("Should we increase Facebook
ad spend?"), Echo may initiate a Roundtable:

1. **Owner-initiated only.** A Roundtable starts from an explicit owner
   question (via Echo). It is never scheduled and never self-triggered.
2. **Echo selects only the relevant departments** for the question and
   issues one bus `request` to each — mechanically, a Roundtable is a
   pre-declared Echo plan (§10 `plan_id`, all requests declared up front,
   the ≤ N step bound applies). No follow-up rounds, no cross-talk between
   departments: each participant sees the question, not each other's
   answers — structurally preventing consensus drift.
3. **Each department answers only from information it owns** — its registry
   topics, its stored data, the same honest-empty rules ("Atlas: Facebook
   isn't connected; I have no campaign data" is a valid, complete answer).
   Perspective framing may use the department's existing AI voice, but
   every factual claim must come from owned stored data — the same
   evidence-first discipline as Sage strategy bets.
4. **Echo never alters responses.** Echo's summary presents, verbatim-
   linked to the underlying responses: areas of agreement, areas of
   disagreement, supporting evidence, risks, and a final recommendation —
   with every department's full answer one click away in the activity log.
5. **The owner always makes the final decision.** The Roundtable produces a
   briefing, not an action. Nothing executes; any resulting work goes
   through each department's existing approval paths, exactly like every
   other output in this architecture (§7 disagreement rules apply
   unchanged — conflicting positions are shown side-by-side, never
   arbitrated by more AI).
6. **Cost bounds:** one Roundtable consumes at most one bus request per
   participant plus one Echo summary call; a per-brand monthly Roundtable
   cap (same pattern as the Executive Debate cap) keeps costs honest.
   Flag: `COLLAB_ROUNDTABLE` (OFF), Stage 3.

The Roundtable is the Collaboration Bus's executive showcase: a structured
review with ownership, evidence, honesty, and approval rules all preserved —
what a real leadership team does when the CEO asks a hard question.

## 14. Rollout plan (each step CEO-gated)

- **Stage 0 — Foundation (dark):** migration (`department_messages`),
  `collaborationBus.js`, `knowledgeRegistry.js`, expiry-sweep branch, flags
  `COLLAB_BUS`, `COLLAB_ACTIVITY_VIEW`, plus one flag per flow
  (`COLLAB_FORGE_SAGE`, `COLLAB_ATLAS_INTEL`, `COLLAB_NOVA_STRATEGY`,
  `COLLAB_PULSE_REPORTS`, `COLLAB_VOICE_INSIGHTS`, `COLLAB_SCOUT_ENRICH`).
  All OFF. Full test suite for chokepoint rules, dedup, expiry, anti-loop.
- **Stage 1 — Read-only consultation:** flows 1–3 (Forge/Atlas/Nova ask
  before creating). Lowest risk: answers come from stored data; failure mode
  is an honest gap note.
- **Stage 2 — Reporting & measurement:** flows 4–6 (Pulse/Voice/Scout feed
  Sage), the Mission Control activity card, and the **Department Performance
  Scorecards** (§12, `COLLAB_DEPT_SCORECARDS`) — deterministic, so lowest
  risk once the bus data exists to measure.
- **Stage 3 — Echo orchestration:** routing, sequencing, alert unification,
  and the **Executive Roundtable** (§13, `COLLAB_ROUNDTABLE`) — it depends
  on Echo's plan mechanics and the consultation flows being proven.
- **Stage 4 — Customer testing:** enable Sage V2 flags + collaboration for
  **one real business**, watch the traffic in the activity view, refine,
  expand gradually — per the CEO's release plan.

Each stage ends with tests, architect review, and a completion report before
the next begins. No stage starts without approval of this document.

## 15. Explicitly out of scope

- Any change to Sage V2 behavior (feature-frozen; bug fixes only).
- Phase 7 (Experiment Engine / Playbooks) — still gated on its own criteria.
- Migrating `sage_directives` onto the Collaboration Bus (possible V2).
- Cross-brand or cross-account collaboration (bus is strictly brand-scoped).
- Any new execution path, spend path, or approval bypass — permanently out
  of scope by principle §0.2.

## 16. What makes this a defining advantage

Most multi-agent platforms have agents that share a codebase but not an
organization. This design gives Zorecho what companies have: **defined
ownership, a paper trail, a chief of staff, an intelligence office, and a
single executive** — with every claim auditable in one table and every rule
enforced in code. The owner doesn't just get ten tools; they get a company
that visibly consults itself before it acts, admits what it doesn't know,
and gets smarter from every decision the owner makes.

**Recommendation:** approve this architecture as the locked collaboration
model. On approval, implementation begins at Stage 0 (dark), under the
standard lifecycle.

---

## Appendix A — Message contract (normative)

The precise lifecycle, so implementation and reporting can never diverge.

**Row roles.** A `request` row tracks the ask; a `response` row (kind
`response`) carries the answer or the decline. Reports and alerts are
single, terminal rows (`status='sent'`, immutable).

**Request status transitions (the only legal ones):**

```
sent → claimed      consumer takes it (atomic claim: status-guarded UPDATE,
                    row-count-branched — same claim discipline as job queues)
sent|claimed → answered   a response row was written (one transaction:
                          insert response + flip request, so they can never
                          disagree)
sent|claimed → declined   a decline response row was written (same one-
                          transaction rule; decline reason lives on the
                          response row's payload AND the request's
                          error_message for cheap querying)
sent|claimed → expired    the expiry sweep passed answer_by (status-guarded
                          so it can never overwrite answered/declined)
claimed → failed    consumer crashed mid-answer; stale-claim rescue flips it
                    with an honest error_message (never silently retried —
                    the requester's gap-note path handles it)
```

Terminal states (`answered/declined/expired/failed`) are final; no row ever
leaves them. Response rows are born terminal and immutable.

**Correlation invariants (DB-enforced where possible):**

- A response's `correlation_id` must reference an existing request row of
  kind `request`, with the **same `brand_id` and `topic`**, and with
  `from_dept`/`to_dept` inverted — checked in the chokepoint transaction.
- **At most one response per request:** partial unique index on
  `correlation_id` where `kind='response'`; a 23505 maps to an honest
  conflict, never a duplicate answer.
- Requests never carry a `correlation_id` (CHECK), except Echo plan steps,
  which carry `plan_id` (§10) — a different column, so ad-hoc request
  chaining remains structurally impossible.

## Appendix B — Bus data governance (payloads, PII, retention)

The bus log is an audit trail, not a data lake. Because `payload` is
free-shape JSONB, governance is enforced at the single chokepoint:

- **Schema-only payloads.** The chokepoint validates every payload against
  the topic's registered schema with `additionalProperties: false` — fields
  not in the schema are rejected, not stripped-and-logged. What isn't
  declared can't enter the log.
- **No secrets, ever.** Topic schemas may not declare token/credential/key
  fields (registry code review rule), and the chokepoint additionally
  rejects payloads containing denylisted key names (`token`, `secret`,
  `password`, `api_key`, `authorization`) as defense in depth. Encrypted
  third-party tokens stay where they live today; the bus never transports
  them.
- **PII minimization.** Person-level topics carry references (lead ids),
  not copies of contact details. Aggregate topics (`customer.language`)
  pass through the existing ingestion redaction before the bus write —
  the same redaction Sage's intel store already applies, moved to the
  producer side so raw PII never lands in `department_messages` at all.
- **Retention.** Bus rows older than **180 days** are purged by the same
  nightly maintenance branch that runs the expiry sweep (deterministic
  DELETE, batch-limited). The durable business record stays where it
  belongs — decisions, directives, intel, outcomes in their owning tables;
  the bus log is operational history, not the system of record.
- **Access.** Bus rows are brand-scoped and surfaced only through
  owner-gated endpoints (the Mission Control activity card); no public or
  cross-brand read path exists.
