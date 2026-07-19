# Zorecho Operational Readiness Roadmap
## Post–Department Collaboration Master Plan

**Prepared for:** James (CEO), Blackfox Ventures
**Prepared by:** Lead Software Engineer (Replit/Claude)
**Date:** July 19, 2026
**Status:** APPROVED IN PRINCIPLE (CEO, July 19, 2026) — this is the **governing operational document** for Zorecho until superseded by a future version. Finalized with two CEO additions: the permanent **CEO Operational Validation** milestone and a **Customer Value Created** section in every phase. No implementation begins without milestone-level CEO approval.
**Standing rules carried forward:** every milestone is a release candidate (main always deployable, everything dark behind flags until approved); Architecture review → Implementation → Testing → Architect self-review → Completion report → CEO approval, for every stage, no exceptions.

---

# Executive Summary

Zorecho today is an engineering success and a commercial pre-product. Sage V2 is feature complete (bug fixes only). Department Collaboration Stage 0 is built, dark, and approved. The platform has ~30 subsystems, 925 automated server tests, disciplined flag-gated releases, and one production deployment (Railway) serving live customers-to-be.

What stands between today and a production-ready AI company is **not more AI features**. It is:

1. **Finishing what's started** — Collaboration Stages 1–3, enabled deliberately, measured honestly.
2. **A safety net** — a real staging environment, so a mistake can never again go straight to the live site.
3. **You running your own companies on it daily** — Founder Mode + Internal Beta. Zorecho must earn *your* trust before it asks for a stranger's.
4. **A small trusted customer beta** with real cost controls and a feedback loop.
5. **A readiness checklist** honestly completed before anyone calls it "launched."

**The single most important strategic judgment in this document:** the sequence is deliberately *trust-first*. Every phase produces evidence that the platform behaves honestly under real use before the blast radius widens. That is the same discipline that made Sage V2 and Stage 0 clean — applied to the company itself.

**Recommended headline order:** Staging Environment → Collab Stage 1 → Founder Mode v1 → Internal Beta begins (and never stops) → Collab Stage 2 → Founder Mode v2 → Collab Stage 3 → Trusted Customer Beta → Readiness checklist → Public launch. Estimated calendar: roughly 4–6 months to a defensible public launch, dominated not by engineering time but by **observation windows** — weeks where the right move is to watch, not build.

**Permanent cadence rule (CEO directive, July 19, 2026):** after every major implementation milestone, engineering pauses for one week of **CEO Operational Validation** (see the standing milestone below). Real-world usefulness is validated before anything further is built.

---

# CEO Operational Validation — Permanent Standing Milestone

**Applies after every major implementation milestone, without exception.** When a milestone completes its lifecycle (tests → architect review → completion report → CEO approval), engineering **stops for one week**. During that week the CEO operates his real businesses through Zorecho exactly as a customer would — no engineer-assisted workarounds, no special knowledge applied, no fixes shipped mid-week (trust-fatal incidents excepted, per the Internal Beta fix rules).

**The seven questions.** At the end of each validation week, these must be answered in writing (the field journal is the natural home):

1. What saved me time?
2. What frustrated me?
3. What did I ignore?
4. What surprised me?
5. What feature did I rely on most?
6. What feature did I expect but didn't exist?
7. Would I miss this if it disappeared tomorrow?

**How the answers are used.** Engineering priorities for the **next** milestone are influenced by these observations before that milestone's architecture note is written. The answers are reviewed alongside the milestone's own success criteria; a milestone that passed its tests but failed question 7 ("no, I wouldn't miss it") is a signal to change course, not to keep building. Answers accumulate milestone over milestone — trends across validation weeks (the same frustration twice, the same ignored feature twice) outrank any single week's notes.

**Effect on the timeline.** Every estimate in this document already assumes observation windows dominate the calendar; this milestone formalizes it. One validation week per major milestone is added to the critical path deliberately — it is the cheapest quality gate in the program.

---

# Phase 1 — Department Collaboration Completion

The architecture is locked (`ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md`). Nothing below changes it; this is the execution roadmap for Stages 1–4.

## Stage 1 — Read-only Consultation (flows 1–3)

**Objective.** Forge, Atlas, and Nova consult stored intelligence (Sage strategy, Company Truth, Scout intel) before generating work — and honestly disclose when no intelligence existed.

**Deliverables.**
- Flow 1 (`COLLAB_FORGE_SAGE`): Forge requests `strategy.current` + `truth.company` before creative generation; briefs cite the live bet they serve or carry the honest gap note.
- Flow 2 (`COLLAB_ATLAS_INTEL`): Atlas requests `intel.competitor` + `strategy.current` before campaign drafts.
- Flow 3 (`COLLAB_NOVA_STRATEGY`): Nova requests `strategy.current` at autopilot/calendar batch time; off-strategy items flagged, never silently dropped.
- Owner-side responders for Sage and Scout topics (answer from stored, validated data only — zero AI cost, per the registry's `lookup` class).
- Gap notes appended **in code** (the `collaborationContext` argument to existing prompt builders), never left to the AI.
- Tests per flow: consult-hit, consult-miss (gap note travels to approval queue), decline path, expiry path, dedup-served path, flag-dark path.

**Complexity: Medium.** The bus does the hard part; the work is wiring six producer/consumer seams into existing prompt builders without disturbing them.

**Risks.**
- Prompt-builder regressions in Forge/Atlas/Nova (the highest-traffic generation paths). Mitigation: `collaborationContext` is additive and optional; dark = byte-identical prompts (assert in tests).
- Latency: a consult adds a DB round-trip (lookup topics are AI-free). Mitigation: dedup freshness windows already make repeat consults free.
- Silent drift: a flow silently stops consulting. Mitigation: bus log is the audit trail; Stage 2 scorecards will surface consult rates.

**Dependencies.** Stage 0 (done). Sage V2 strategy/truth stores (done, dark — Stage 1 responders read them regardless of the Sage V2 display flags, per the approved architecture).

**Testing requirements.** Per-flow suites above + full-suite zero-regression + a dark-parity test proving prompts are unchanged with flags off + architect review + completion report.

**Success criteria.** With flags on (dev/internal only): ≥95% of generation events either cite intelligence or carry a gap note; zero blocked generations (collaboration never blocks the core job); zero regressions; consult answers always match the registry schema.

## Stage 2 — Reporting, Measurement & Scorecards (flows 4–6 + activity view + scorecards)

**Objective.** Pulse, Voice, and Scout feed Sage continuously; the owner can *see* departments working together; department performance becomes deterministic numbers.

**Deliverables.**
- Flow 4 (`COLLAB_PULSE_REPORTS`): Pulse → Sage `leads.outcomes` reports after outcome updates.
- Flow 5 (`COLLAB_VOICE_INSIGHTS`): Voice → Pulse/Sage weekly `customer.language` aggregate (producer-side PII redaction before the bus write).
- Flow 6 (`COLLAB_SCOUT_ENRICH`): Scout → Sage `intel.competitor` report on new confirmed intel (uniformizing an existing path).
- Mission Control activity card (`COLLAB_ACTIVITY_VIEW`): owner-facing, plain-English bus activity.
- Department Performance Scorecards (`COLLAB_DEPT_SCORECARDS`, §12): deterministic, computed from bus + existing data, no AI.
- Tests: report publication ownership, redaction assertions on `customer.language`, scorecard determinism (same inputs → same numbers), activity view brand-scoping.

**Complexity: Medium.** Producers are simple (owner publishes facts it already computes); scorecards are deterministic aggregation; the activity view is a read-only UI card.

**Risks.** Scorecard misinterpretation (a low score read as "broken" when it means "no data yet") — mitigate with explicit "insufficient data" states, never zeros (our NULL-not-0 house rule). PII leakage via `customer.language` — mitigated three ways: producer redaction, schema-only payloads, denylist scan.

**Dependencies.** Stage 1 proven (scorecards measure consultation behavior; without Stage 1 traffic there is little to score). Sage V2 Phase 3 outcome capture (done).

**Testing requirements.** As above + client tests for the activity card + architect review + completion report.

**Success criteria.** Weekly reports flow without manual triggering; scorecards render honestly for a brand with zero data; you can read the activity card and correctly narrate "who asked whom for what" without my help.

## Stage 3 — Echo Orchestration + Executive Roundtable

**Objective.** Echo becomes the coordinator: multi-step plans (`plan_id` mechanics), alert unification, sequencing — and the owner-initiated Executive Roundtable (§13).

**Deliverables.**
- Echo plan mechanics: plan creation, step sequencing over the bus, plan-scoped requests (the `plan_id` column and its Echo-only CHECK are already in place).
- Alert unification: department alerts route through Echo into the existing notification/voice surfaces — one voice, no competing pop-ups.
- Executive Roundtable (`COLLAB_ROUNDTABLE`): owner-initiated only, bounded rounds, produces a written brief for owner decision.
- Tests: plan step ordering, plan expiry/failure honesty, alert dedup, roundtable round caps, "owner decides — never the AIs voting."

**Complexity: High.** This is the first *stateful multi-step* AI coordination. Failure modes multiply (partial plans, stalled steps, conflicting alerts).

**Risks.** Highest of any stage: runaway plans (mitigated: plans have step caps and expiries per the architecture), cost creep (every plan step is bus-logged and cap-bounded), and complexity debt. **Recommendation: do not start Stage 3 until Stages 1–2 have run clean for at least 2–3 weeks of Internal Beta traffic.**

**Dependencies.** Stages 1–2 proven under real (internal) traffic. Echo's existing orchestrator (Hermes decide()) unchanged — Stage 3 builds beside it, dark.

**Testing requirements.** The heaviest suite of the program: plan lifecycle matrix (complete/partial/expired/failed), concurrency (two plans over one topic), alert storm scenarios, architect review, completion report.

**Success criteria.** A multi-department plan completes end-to-end with a full audit trail; a deliberately-stalled step expires honestly and the plan reports partial completion; the Roundtable produces a useful brief on a real business question of yours.

## Stage 4 — Customer Testing

**Objective.** Enable Sage V2 + collaboration flags for real businesses, gradually. This stage **is** the Internal Beta → Trusted Customer Beta pipeline (Phases 5–6 below) — it is listed here for completeness but executed through those phases, one brand at a time, watching the activity view.

## Customer Value Created

- **Customer experience:** the customer stops managing ten separate tools that happen to share a login. Ads reference the strategy. Content serves the current bet. Reports reach the strategist automatically. It feels like hiring a coordinated team instead of ten freelancers.
- **Business problem solved:** small-business owners are the only integration point between their marketing channels — every insight travels through their memory and their time. Collaboration removes the owner as the bottleneck.
- **Why customers care:** their creative and campaigns visibly cite *why* ("Supports Bet 1: fill units in the 78745 zip"). Marketing stops feeling random.
- **How it increases trust:** the honesty is structural — when no strategy exists, the work says so in writing instead of pretending. Customers learn the platform never bluffs, which is precisely what makes them believe it when it *does* cite intelligence.
- **How it improves retention:** coordinated departments compound — every month of use makes the shared intelligence richer and switching away more costly. The activity view lets the owner *see* the team working, which is the emotional core of "this is worth $350/month."
- **How success is measured:** citation/gap-note rate on generated work, scorecard consult rates, owner approval rates on collaboration-informed vs uninformed drafts, and ultimately retention of brands with collaboration on vs off.

---

# Phase 2 — CEO Daily Operations

How you run your companies on Zorecho every day. Everything below uses features that exist today (some dark, pending enablement); nothing requires new construction beyond the phases in this roadmap.

## Morning routine (07:30–08:15, ~20 min of your attention)

1. **Open Zorecho → Echo's morning briefing plays** (voice or read): overnight lead activity, autonomous conversations Echo handled, appointments booked, anything that failed — per active brand.
2. **Sentinel's health status** (hourly sweep ran all night): connection problems surfaced with plain-English fixes ("Facebook token for South Dixie Storage expires in 3 days — Reconnect").
3. **Pulse's hot leads**: who's warm right now, who went quiet, auto-created follow-up tasks from stale hot leads.
4. **Approvals queue** (the single most important CEO habit): Autopilot content/ad batches, Echo Email drafts, autonomous-conversation escalations. Approve/decline/revise — every decision feeds the Learning Engine.
5. **Vision check** — glance at the ROI dashboard trend line, not the details.

*Departments on duty:* Echo (briefing, voice), Sentinel (health), Pulse (leads), Nova/Forge (the batch you're approving), Sage (the briefing's strategic framing).

## Midday review (12:30, ~5 min)

- Echo surfaces anything that changed state since morning: a strong buying signal in an autonomous conversation (voice+SMS alert already fired if urgent), a competitor's aggressive new ad (Scout, Enterprise brands), a failed post that was rescued.
- You answer one question at most: "transfer it," "approve it," or "leave it."

*Departments:* Echo (triage), Pulse (conversations), Scout (ad spy), Atlas (in-flight campaign anomalies).

## Afternoon follow-up (16:00, ~10 min)

- **Echo Personal Assistant** check-in: today's task list state, reminders delivered, what rolled to tomorrow.
- **Echo Email Assistant**: the 15-minute triage has been running all day; approve any held drafts.
- SMS/email campaign sends of the day: delivered/failed split; "fix-first vs safe-to-retry" grouping if anything failed.

*Departments:* Echo (assistant + email), Nova (sends), Sentinel (failure classification).

## End-of-day review (18:30, ~5 min)

- Echo's closing check-in: what got done, what's queued for tomorrow, any decision that's still waiting on you (decisions >24h old get named explicitly — silence is never treated as consent).

## Weekly executive review (Monday, ~30 min — Zorecho's strongest moment)

Monday is when the platform's weekly machinery lands, in order:
- 05:00 Autopilot Learning Engine study (your week of approve/decline decisions distilled into learnings + clarifying questions).
- Morning: **Sage's weekly briefing** — one consolidated output: strategy bets status, channel scorecards, forecasts, opportunity queue (3 decisions max), intel digest.
- 07:15 **Sage Self-Review** (admin view): what the platform itself did poorly last week, evidence-based, recommendation-only.
- Scout's weekly ad-intelligence report (Enterprise brands).
- **Your 30 minutes:** read the briefing per brand → make the ≤3 opportunity-queue decisions → answer Autopilot's clarifying questions → skim the self-review and mark items planned/dismissed.

After Collab Stage 2: the **department scorecards** join this review — one honest table of who consulted whom, response times, gap-note rates. After Stage 3: you can convene the **Roundtable** on the week's hardest question.

## Monthly executive review (first Monday, ~1 hour)

- Trajectory over trend: 4 weekly briefings side by side per brand — are the strategy bets converging on their success thresholds (each bet has objective/timeframe/KPI/threshold/review-date by design)?
- Outcome-capture coverage (the program-level metric): is lead outcome data ≥ the 30%/50% gates that unlock later phases?
- Cost review: AI ledger totals per brand per department — is any department's cost growing faster than its measurable contribution?
- Platform review: Sage Self-Review items marked "planned" — pick which become engineering milestones.
- Beta review (once running): tester activity, conversion candidates, waitlist.

## Customer Value Created

- **Customer experience:** this phase *is* the customer experience — the daily/weekly routine designed here becomes the template every customer inherits. A business owner gets a repeatable ~45-minute rhythm that replaces hours of scattered checking.
- **Business problem solved:** owners don't fail at marketing for lack of tools; they fail for lack of a manageable routine. This phase turns "an app I should check" into "the way I run my mornings."
- **Why customers care:** the promise becomes concrete — open Zorecho at 7:30, know everything that matters, make three decisions on Monday, done.
- **How it increases trust:** a routine only survives if the information in it is reliable; by living this routine first on real businesses, every weak briefing or noisy alert gets found and fixed before a customer experiences it.
- **How it improves retention:** habits retain customers far better than features. A product woven into the owner's daily routine is not churned casually.
- **How success is measured:** daily active use of the briefing and approval queue, Monday review completion (the ≤3 weekly decisions actually made), and time-in-app staying *low* while decisions-made stays high — Zorecho succeeds when it takes less of the owner's day, not more.

---

# Phase 3 — Founder Mode (architecture for a later, CEO-gated build)

**What it is:** an internal, admin-only engineering-grade cockpit — the difference between *using* Zorecho (the dashboard customers see) and *trusting* Zorecho (seeing exactly what the machine did and why). Nothing here is customer-facing, ever.

**Placement:** a new admin-only area (route-guarded like `/api/admin/*`, `requireRole admin`, invisible to every other account), built dark behind `FOUNDER_MODE` — following the exact pattern of the Beta and Self-Review admin tabs.

**Recommended build order: two versions.** v1 (items 1–6) before Internal Beta — you need instruments before you fly. v2 (items 7–11) after Collab Stage 2, when the data it displays exists.

## v1 components

1. **Executive Dashboard.** One screen: per-brand status tiles (green/amber/red from real signals, never decorative), today's AI job outcomes (ran/skipped/failed with reasons), the approval queue count, and yesterday-vs-today cost.
2. **Morning Briefing validation.** Side-by-side: what the briefing *claimed* vs the underlying stored data it was built from (the briefing's source rows). Any claim without a source row is flagged — this is the fabrication tripwire, automated.
3. **Department status.** The 10 departments as a table: last run, last success, last failure + honest error, queue depth, flag states that govern them. Sentinel's data, engineering-grade presentation.
4. **AI activity timeline.** Chronological, filterable feed of every AI action (job runs, generations, autonomous replies, bus messages once Stage 1+ is live) with links to the produced artifact. Built from existing logs/ledger — read-only.
5. **AI cost visibility.** The existing AI cost ledger, sliced: per brand, per department, per day; anomaly highlighting (a department 3× its trailing average gets an amber flag). Real numbers only; providers without cost data say so.
6. **Failure reporting.** Every failure the platform recorded (failed posts, expired requests, 502-mapped AI errors, stale-claim rescues, email/SMS permanent failures) in one triaged list: fix-first vs transient, per brand. Nothing hidden, nothing summarized away.

## v2 components

7. **Recommendation explanations.** For every Sage recommendation/opportunity: the evidence rows it cites, its deterministic confidence tier, and what data was *missing* (the honesty ledger). Extends Phase 5's explanation machinery into one inspector view.
8. **Operational health.** Trend lines on the boring-but-vital: job punctuality (scheduled vs actual run times), queue latencies, bus expiry rates, webhook success rates, migration status.
9. **Customer readiness.** Per brand: setup completeness (guided-setup probes), connection health, outcome-capture coverage, feature adoption — the "is this business actually able to benefit yet?" score.
10. **Trust metrics.** The numbers this roadmap is built around: gap-note rate (how often departments honestly said "no data"), briefing-validation pass rate, approval-queue override rate (how often you rejected AI output), autonomous-conversation transfer rate. Trust = the machine's honesty being verifiable.
11. **Internal diagnostics.** The existing admin diagnostic report + quota monitor + flag panel unified: run an account self-scan, view/flip any feature flag (with audit log), inspect a brand's raw stored state.

**Complexity:** v1 Medium (almost entirely read-only views over existing data); v2 Medium. **Risk:** low — read-only by construction; the only write surface is the flag panel, which already exists. **Success criterion:** you can answer "what did Zorecho do for South Dixie Storage yesterday, what did it cost, and did anything fail?" in under two minutes, without asking me.

## Customer Value Created

- **Customer experience:** customers never see Founder Mode — but they feel it. Every fabrication tripwire, cost anomaly, and failure surfaced here is caught before it reaches a customer's briefing or bill.
- **Business problem solved:** an AI platform that can't inspect its own honesty will eventually ship a confident lie. Founder Mode makes the platform's truthfulness auditable *before* strangers depend on it.
- **Why customers care:** they're trusting an AI with their marketing budget and their leads. "The CEO verifies every claim-type against source data on his own businesses" is a sales-grade trust statement — and it's true.
- **How it increases trust:** trust metrics (validation pass rate, gap-note honesty, override rates) become measured numbers with history, not assurances. Problems get fixed from evidence, not anecdotes.
- **How it improves retention:** the failures that kill retention are silent ones — a briefing quietly wrong, a cost quietly ballooning. Founder Mode exists to make silent failure structurally impossible to miss.
- **How success is measured:** briefing-validation pass rate ≥99%, time-to-detection of injected test failures, and zero customer-reported incidents that Founder Mode hadn't already surfaced first.

---

# Phase 4 — Staging Environment

**The single highest-value infrastructure change available to us**, and I recommend it be the very next implementation milestone — before Collab Stage 1 — because every subsequent phase gets safer the moment it exists.

## Design

- **Railway staging service.** A second Railway service in the same project, auto-deploying from a new `staging` branch. Identical build (`npm run start:prod` — migrate → build client → start).
- **Separate staging database.** A second Railway Postgres instance. **Never** shared with production; never seeded from raw production data (see data policy below).
- **Deployment pipeline.** Replit workspace (dev, my environment) → push to `staging` branch → Railway staging auto-deploys → verification → merge/promote `staging` → `main` → Railway production auto-deploys. Your Git-panel Push stays the human trigger at both promotion points.
- **Promotion workflow.** (1) I complete a milestone here (tests green, architect-reviewed, completion report). (2) Push to `staging`. (3) Staging deploys; migrations run against the staging DB — the *first* time any migration touches a non-dev database. (4) Smoke pass on staging (login, briefing, one generation, health endpoint, new-feature dark checks). (5) CEO approval. (6) Promote to `main`. Nothing reaches `main` that didn't run on staging first.
- **Rollback process.** Two layers. *Code:* Railway redeploys any previous deployment in one click (both services keep deploy history) — that's the 2-minute rollback. *Schema:* our migrations are additive-only by house rule (Stage 0 continued this), which is precisely what makes code rollback safe — the old code simply ignores new columns/tables. Any migration that must be destructive gets an explicit CEO-approved plan of its own.
- **Configuration management.** Same variable *names* in both environments, different *values* (Railway per-service variables). One documented checklist (`STAGING_ENV.md`, written when we build this) listing every variable and its staging policy: real / test-mode / unset.
- **Environment variables on staging (recommended policy).** Boot-critical four (`DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`): staging-unique values, never production's. Stripe: **test-mode keys** (this is the big win — full billing flows exercised with fake cards). AI keys: real (real behavior is the point), protected by the platform's own cost caps + a staging-only lower daily cap. Twilio: a dedicated staging number or unset (degrades gracefully to 503 by design). Facebook/Google OAuth: same app, staging redirect URI added; connect a sandbox/test account, not a customer's. Web-push VAPID: staging-unique pair. `FREE_TEST_MODE`: on (staging accounts are all "beta").
- **Migration strategy.** Staging is the migration rehearsal: every migration runs there against realistic-shape data days before production. Keep the fresh-DB bootstrap rule (schema.sql first) verified on staging quarterly by rebuilding the staging DB from scratch — that also enforces the data policy.
- **Data policy (important).** Staging data is synthetic: the demo-seed machinery + a small set of hand-made staging brands. **No production customer data is ever copied to staging** — it doubles our breach surface for near-zero testing value. If a production bug needs production-shaped data, we debug with read-only production queries (existing tooling), not data copies.
- **Testing before production.** The three automated gates (server, client, build) remain the merge bar in dev; staging adds the *environmental* checks automation can't cover: real proxy/TLS, real OAuth redirects, real Stripe test-mode webhooks, migration-on-nonempty-DB, PWA/service-worker behavior on a real domain.

**Complexity: Low-Medium** (mostly configuration + one documented workflow; ~a day of setup plus the checklist doc). **Risks:** environment drift (staging quietly stops matching production) — mitigated by the variable checklist and the quarterly rebuild; false confidence (staging passes, production differs) — mitigated by keeping the variable *names* and code paths identical. **Dependencies:** none. It can start immediately upon approval.

## Customer Value Created

- **Customer experience:** customers never see staging — they experience its absence of consequences: no broken mornings after a release, no "sorry, that update had a bug," no downtime during business hours.
- **Business problem solved:** a small business running its lead capture and follow-up on Zorecho cannot afford our mistakes. Staging means our mistakes happen in a room with no customers in it.
- **Why customers care:** reliability is the product. An owner who delegates their marketing to an AI is really buying the confidence that it works every single day.
- **How it increases trust:** every migration and feature rehearses on staging before touching customer data — and the rollback drill means even a surprise is a minutes-long event, not an outage.
- **How it improves retention:** nothing churns a small-business customer faster than the tool failing during their busy week. Fewer incidents is the most direct retention investment available.
- **How success is measured:** production incidents caused by deployments (target: zero after staging exists), time-to-rollback when needed (minutes), and migration failures reaching production (zero).

---

# Phase 5 — Internal Beta (you, running your companies on Zorecho)

**Principle:** Zorecho's first demanding customer is its own CEO. Nothing goes to outside customers that hasn't survived your daily use.

## The businesses

| Business | Type | Zorecho fit |
|---|---|---|
| **Blackfox Ventures** | Holding/parent | Portfolio lens: Vision's multi-business dashboard, cross-brand weekly review. Likely light on ads, heavy on oversight. |
| **South Dixie Storage** | Self-storage | The strongest end-to-end test: local ads (Atlas), lead capture + autonomous conversations (Pulse/Echo), reviews (reputation), phone agent, SMS. Clear ground truth: units rented. |
| **BlaCor Homes** | Real estate | Exercises the real-estate vertical (Property CRM, listings, buyer/seller leads, open houses, Atlas/Nova automations). Already present as a brand. |
| Any additional brands on the platform | — | Enrolled the same way, one at a time, only after the first three are stable. |

Each business is one brand with honest Company Truth and brand discovery completed via the Guided Setup — done properly, as a customer would, because setup quality is itself under test.

## How success is measured

Ground truth per business, decided before enrollment (examples): South Dixie — leads captured, conversations handled without your intervention, units rented that trace to a Zorecho-touched lead; BlaCor — qualified buyer/seller leads, open-house attendance from Zorecho promotion; Blackfox — did the weekly portfolio review actually replace a manual process of yours?

Platform-wide readiness metrics (the numbers that gate Phase 6):
- **Trust:** briefing-validation pass rate ≥99% (no unsourced claims); zero fabrication incidents.
- **Autonomy quality:** your approval rate on Autopilot/queues trending up over 4 weeks (the Learning Engine visibly learning you).
- **Reliability:** zero silent failures (everything that failed said so, in the right place); scheduled jobs ≥99% punctual.
- **Outcome capture:** ≥30% lead-outcome coverage on your own businesses (if *you* won't log outcomes, customers never will — this is the program-level metric from MILESTONES.md).
- **Cost:** per-brand monthly AI cost stable and unsurprising for 4 consecutive weeks.

## Daily observations (the CEO field journal)

The Phase 2 daily routine, plus one discipline: a one-line note whenever the platform surprises you (good or bad). Founder Mode v1's failure list + activity timeline is your evidence surface. Ten seconds a note; these notes become the Phase 6 design inputs.

## Weekly reviews

The Phase 2 Monday review, plus 15 internal-beta minutes: journal notes → triage each as **fix now / fix later / ignore**; check the readiness metrics above; decide whether any dark flag earns enablement for your brands this week (one flag at a time, watch a full week).

## When something should be fixed vs ignored

**Fix immediately:** anything dishonest (fabricated claim, silent failure, wrong number presented confidently) — these are trust-fatal, zero tolerance; anything that loses data; anything that costs money without authorization.
**Fix soon:** friction you hit repeatedly; confusing wording; a feature you avoid because it's awkward (avoidance is data).
**Ignore (deliberately):** cosmetic issues on rarely-used screens; features your businesses don't exercise (note them for beta-customer matching instead); one-time transients that self-reported and self-recovered — the platform behaving as designed is not a bug.

**Exit criterion for Phase 5 → 6:** all five readiness metrics green for **four consecutive weeks** across at least two of your businesses, and your honest answer to one question is yes: *"Would I be comfortable watching a stranger's business run on exactly what I used this month?"*

## Customer Value Created

- **Customer experience:** every rough edge, confusing screen, and broken promise gets discovered by the founder instead of by a paying customer. The first outside customer inherits a product that has already survived three real businesses.
- **Business problem solved:** most software is tested by engineers who don't live the customer's problem. Internal Beta closes that gap — the CEO of a storage business, a real-estate company, and a holding company runs his actual operations through the product.
- **Why customers care:** "we run our own companies on it" is the strongest claim a business tool can make — and after this phase it is literally, verifiably true.
- **How it increases trust:** the readiness metrics (no fabrications, no silent failures, stable costs) are proven on real stakes before any customer bears them.
- **How it improves retention:** the fix-now/fix-later/ignore triage means the issues that actually drive churn — repeated friction, avoided features — get fixed in priority order, informed by genuine use.
- **How success is measured:** the five readiness metrics held green for four consecutive weeks, plus per-business ground truth (units rented, qualified leads, a replaced manual process).

---

# Phase 6 — Trusted Customer Beta

## Ideal beta customer profile

- A local service business with real lead flow (5–50 leads/month) — storage, home services, real estate, auto — where Zorecho's verticals and your own Internal Beta experience overlap.
- The owner is reachable, opinionated, and personally known to you or one degree away (this beta runs on relationships, not funnels).
- Has a Facebook presence (our deepest integration) and a real appetite for delegating marketing.
- Explicitly NOT ideal: agencies (they'll evaluate it as resellers — that's the white-label track, later), enterprises, and anyone who won't reply to a weekly check-in.

## Number of beta businesses

**Start with 3. Cap at 10.** Three exercises variety without overwhelming the support workflow (which is you + me); ten is the most weekly-touch relationships one person can honestly maintain. The existing Beta Program machinery (slot cap, waitlist, activity tracking) is the enforcement mechanism — set max slots to the current wave's size, never more.

## Invitation process

Personal, not self-serve: you invite by name → `FREE_TEST_MODE` on (or the invite-code improvement below) → they sign up, land in the Guided Setup Wizard, and complete it **without your help** — setup completion-without-assistance is itself a readiness metric. Expectations set in writing up front: it's a beta, weekly feedback is the price of free Enterprise access, and either side can end it.

**Recommended small build (flagged, CEO-gated like everything):** invite codes, so a specific person can be admitted while public signups stay closed. This was already identified in the Beta refresher as the top beta-program improvement; Phase 6 is when it earns its build.

## Feedback collection

- **Weekly 15-minute check-in call** per beta business (you or, later, a hire) — the primary channel; notes go in the field journal.
- In-product: the existing Echo feature-suggestion capture (auto-logged, deduped, count-ranked in your admin tab) keeps working silently.
- Monthly: their numbers vs their ground truth ("did you rent more units?") — the only feedback that ultimately matters.

## Feature rollout during beta

Same one-flag-at-a-time discipline as Internal Beta: new capabilities (Collab flows, Sage V2 surfaces) enable for beta brands only after running clean on your brands for ≥2 weeks. The activity view + Founder Mode are your watch instruments. Never enable anything for all beta brands simultaneously — one brand, one week, then the rest.

## Cost controls

- Per-brand AI budget alarm (extend the existing quota monitor + cost ledger): amber at a set monthly threshold, hard platform-cap intact.
- Beta cap = cost cap: 10 businesses × observed per-brand cost from Internal Beta = a known, bounded monthly beta budget you approve in advance.
- Autopilot spend limits (already built) set conservatively for beta brands.

## Support workflow

- Tier 1: the in-product AI support (`/api/public/support`) + health monitor already deployed.
- Tier 2: you, via the weekly call + a direct channel (text/email) with a stated response window (e.g., same business day).
- Tier 3: me — bugs arrive as field-journal entries or support transcripts; fixes ride the staging → production pipeline; beta customers never get hotfixes that skipped staging.

## Conversion process

The one-click Convert-to-Paid (built) is the mechanism; the moment is when their monthly numbers beat their ground-truth baseline and they say so on a check-in. Founding-customer pricing (a permanent discount for beta alumni) is a CEO/Creative-Director decision — flagging it now so ChatGPT can draft the offer when the time comes.

## Exit criteria for public launch

- ≥7 of 10 beta businesses active in week 8 (activity per the existing beta tracking).
- ≥5 converted to paid, unprompted or on first ask.
- Ground-truth improvement demonstrable in at least half the businesses.
- Support load ≤2 hours/week total at 10 businesses (else it won't scale past them).
- Zero unresolved trust incidents in the final 4 weeks.
- The Phase 7 checklist below: 100% complete.

## Customer Value Created

- **Customer experience:** beta customers get white-glove treatment — free Enterprise access, a weekly call with the CEO, and visible influence over the product. Their feedback demonstrably shapes what ships next.
- **Business problem solved:** it proves, on businesses we don't own, that Zorecho creates measurable value for a stranger — the only evidence that matters before charging the public.
- **Why customers care (beta cohort):** they get a marketing team's output for free during the beta, founding-customer terms afterward, and a product tuned to businesses exactly like theirs.
- **Why customers care (future cohort):** the public launch product is shaped by ten real businesses' feedback, not by engineering guesses.
- **How it increases trust:** the conversion moment is honest by design — customers convert when *their* numbers beat *their* baseline, not when a sales sequence expires.
- **How it improves retention:** beta alumni who converted on evidence become the highest-retention cohort and the reference customers whose stories retain everyone after them.
- **How it is measured:** week-8 activity (≥7 of 10), unprompted conversions (≥5), ground-truth improvement in half the businesses, support load ≤2 hrs/week.

---

# Phase 7 — Product Readiness Checklist (the public-launch gate)

Every item gets a real verification, not a vibe. Grouped; each line is checkable.

**Platform stability.** 30 days production error-rate baseline established and boring; scheduled jobs ≥99% punctual over 30 days; zero data-loss incidents ever; rollback drill actually performed on staging (not just documented); load sanity test at 5× beta traffic.

**Customer onboarding.** ≥8 of 10 beta signups completed Guided Setup unassisted; median setup time known; every OAuth error path shows the plain-English translation; "Help Me" screenshot rescue verified on real confused users.

**Documentation.** Customer-facing help for every section (ChatGPT drafts per the operating model, you approve); internal runbook: deploy, rollback, incident response, every env var (README is close — needs the ops runbook chapter); this roadmap's successor: a living ops calendar.

**Training.** The onboarding tour + demo mode current with shipped features; a 30-minute "first week with Zorecho" path a beta customer has actually followed successfully.

**Support.** Response-time commitment defined and met during beta; AI support answer quality reviewed monthly against transcripts; escalation path (AI → you → me) exercised at least once for real.

**Billing.** Full Stripe lifecycle exercised in test mode on staging: subscribe, upgrade (instant), downgrade (deferred), seat add/remove, payment failure → lockout → recovery, webhooks under retry; live-mode verified with one real card (yours); dunning emails reviewed by ChatGPT for tone.

**Facebook integration.** Token-expiry path clean (Sentinel warns, Reconnect works); publish + ads + ad spy verified on ≥3 distinct real accounts; app review/permissions status confirmed current for public use.

**Google integration.** OAuth + reads verified on ≥3 accounts; SEO tools verified; quota headroom confirmed for target customer count.

**CRM.** Lead dedup verified under real concurrent capture; autonomous-conversation transfer honored end-to-end; both vertical CRMs (property, voter) exercised by at least one real brand each or explicitly deferred from launch scope (CEO call).

**Morning briefing quality.** Validation pass rate ≥99% over the final 30 beta days (Founder Mode tripwire); a new-empty-account briefing reads warmly and honestly (already designed — verify it stayed true).

**Department collaboration.** Stages 1–2 live for all beta brands ≥4 weeks; scorecards read sensibly; Stage 3 live for your brands at minimum (CEO call whether it's in the public launch or fast-follows).

**Security.** Dependency audit + SAST + secrets scan run and criticals cleared (the security-scan tooling exists — schedule it); SSRF allowlists re-verified (house invariant); rate limits sanity-tested; auth/lockout/ownership spot-audit on newest routes; encryption-at-rest confirmed for every stored third-party token; JWT/session secret rotation procedure documented.

**Performance.** p95 API latency baseline measured and acceptable on the briefing, dashboard, and generation endpoints; client bundle size reviewed; DB indexes verified against the slowest real queries (pg_stat once traffic exists).

**Disaster recovery.** Railway Postgres backup schedule confirmed + **one actual restore drill to staging** (a backup you haven't restored is a hope, not a backup); uploads durability re-verified (BYTEA source of truth — already designed for Railway's ephemeral disk); "Railway is down" runbook page: what you tell customers, what I do.

## Customer Value Created

- **Customer experience:** every checklist line is a customer promise made keepable: onboarding they can finish alone, billing that never surprises them, integrations that reconnect gracefully, help that actually helps, data that survives a disaster.
- **Business problem solved:** small businesses have been burned by tools that launched before they were ready. This checklist is the difference between "available for purchase" and "ready to be depended on."
- **Why customers care:** none of them will read the checklist — all of them will feel it as an absence of bad days.
- **How it increases trust:** the checklist is verification-based ("a restore drill was performed"), never aspiration-based ("backups are configured"). That standard is the company's character, expressed as operations.
- **How it improves retention:** most churn in the first 90 days traces to onboarding failure, billing surprise, or an unresolved incident — the three areas this checklist tests hardest.
- **How it is measured:** 100% of items verified (not asserted); then post-launch: first-90-day churn, onboarding completion rate, support tickets per customer per month.

---

# Phase 8 — First Year Growth (high level)

**Quarter framing from public launch (call it Q1):**

**Q1 — Prove repeatability (0→25 customers).** Beta conversions + referrals only. Goal is not volume; it's that onboarding, support, and billing survive contact with strangers at 25 accounts with support ≤ a few hours/week. Infrastructure: none new — Railway scales vertically first. Technical-debt priority: whatever the beta field journal ranked #1.

**Q2 — Remove the founder bottleneck (25→75).** First hire: a **customer success / support person** (not an engineer) — the weekly-check-in model must outlive your calendar. Sage V2 Phase 7 gate check (outcome coverage >50%, 6 months history) — if green, the Experiment Engine becomes the quarter's flagship. Infrastructure: read-replica or connection pooling if DB pressure appears; job-queue observability (Founder Mode v2 trends decide).

**Q3 — Deepen, don't widen (75→150).** Resist new AI departments; the 10-department model is a strength — make each measurably better using scorecard + outcome data. Candidate exceptions, only if customer demand is explicit: deeper Google Ads write-side, or the white-label/agency channel (built, Enterprise-gated — a distribution decision, not an engineering one). Second hire: engineer #1, chosen for testing discipline (the 925-test culture is the asset to protect). Begin SOC 2-lite security posture work if any customer's procurement asks.

**Q4 — Durability (150→300).** Infrastructure: evaluate Postgres scaling (partitioning the largest tables — leads, messages, department_messages traffic will tell us); formal SLA + status page; disaster-recovery drill cadence quarterly. Technical-debt sweep: retire `FREE_TEST_MODE` in favor of invite codes fully; consolidate the oldest migration files; client bundle splitting if size crept. Team: support person #2 or engineer #2, whichever the constraint is — decided by where your hours are going.

**Standing first-year rules:** no new AI department without a quarter of customer evidence; every hire must remove a named bottleneck (not "help generally"); infrastructure spend follows measured pressure, never anticipation; the CEO-gated milestone discipline survives growth — it *is* the company's engineering culture now.

## Customer Value Created

- **Customer experience:** the product a customer joined for keeps working exactly as well at 300 customers as it did at 3 — same reliability, same response times, same honesty — while measurably improving each quarter in the areas customers actually use.
- **Business problem solved:** most SaaS products degrade as they grow — support slows, quality slips, focus scatters. This plan grows capacity (hires, infrastructure) *ahead* of the pressure customers would otherwise feel.
- **Why customers care:** the "deepen, don't widen" rule means their existing tools get better instead of being abandoned for shiny new ones; the customer-success hire means a human still answers.
- **How it increases trust:** durability is trust over time — SLAs, a status page, quarterly disaster drills, and security posture work all convert "we care" into commitments a business can rely on.
- **How it improves retention:** every quarter's technical-debt priority comes from real customer friction (the field journal, then support data) — retention work is literally scheduled into the roadmap.
- **How it is measured:** net revenue retention, support response times holding as customer count grows, uptime against the SLA, and quarterly improvement in each department's scorecard on real customer brands.

---

# Priority Matrix

| Initiative | Impact | Effort | Risk if skipped | Priority |
|---|---|---|---|---|
| Staging environment | Very high | Low-Med | A bad push hits live customers | **P0 — next milestone** |
| Collab Stage 1 | High | Med | Departments stay siloed; the moat stalls | **P0** |
| Founder Mode v1 | High | Med | Flying blind into beta | **P1** |
| Internal Beta (start) | Very high | Low (ops, not code) | No evidence for customer beta | **P1 — starts the week Founder Mode v1 lands** |
| Collab Stage 2 (+ scorecards) | High | Med | No measurement of collaboration | **P2** |
| Founder Mode v2 | Med-High | Med | Weaker trust instrumentation | **P2** |
| Invite codes + per-brand cost alarms | Med | Low | Blunt beta admission; cost surprises | **P2 (small, rides along)** |
| Collab Stage 3 (+ Roundtable) | High | High | Echo never becomes a coordinator | **P3 — only after Stages 1–2 prove out** |
| Trusted Customer Beta | Very high | Low (ops) | — | **P3 — gated on Internal Beta metrics** |
| Readiness checklist execution | Very high | Med (spread out) | Launching on hope | **P4 — final gate** |

# Timeline (indicative, not promised — observation windows dominate)

- **Weeks 1–2:** Staging environment live + first rehearsed promotion. Collab Stage 1 built dark behind it.
- **Weeks 3–4:** Stage 1 architect-reviewed, enabled for your brands. Founder Mode v1 built.
- **Weeks 5–8:** **Internal Beta core window** — all three businesses live daily; Stage 1 flows watched; Collab Stage 2 built dark during the quiet weeks.
- **Weeks 9–12:** Stage 2 + scorecards enabled internally; Founder Mode v2; readiness metrics tracked for the 4-green-weeks gate.
- **Weeks 13–16:** Collab Stage 3 built + proven internally. First 3 beta customers invited (if Internal Beta gate is green).
- **Weeks 17–24:** Beta wave to 10; readiness checklist executed item by item; exit criteria measured.
- **Week ~24+:** Public-launch decision — yours, on evidence.

# Critical Path

Staging → Collab Stage 1 → Founder Mode v1 → Internal Beta 4-green-weeks gate → Customer Beta → Readiness checklist → Launch — with a one-week CEO Operational Validation after every major milestone on the path.
Everything else (Stage 2/3, Founder Mode v2, small builds) parallelizes around that spine. The critical path's slowest link is deliberately **the Internal Beta observation window** — it cannot be compressed by engineering effort, only by the platform behaving well.

# Risks (program-level)

1. **CEO time is the scarcest resource.** The daily/weekly routines take ~45 min/day. If that's unrealistic across three businesses, we scope Internal Beta to South Dixie first. *Mitigation: the routine is designed to degrade gracefully — the Monday review alone still produces the gate metrics.*
2. **Observation fatigue.** Weeks 5–12 will feel slow — the temptation will be to build features instead of watching. *Mitigation: the parallel dark builds (Stage 2/3, Founder Mode v2) keep engineering moving without touching what's being observed.*
3. **Stage 3 complexity.** The riskiest build of the program. *Mitigation: hard gate behind Stages 1–2 evidence; step caps and expiries are already in the locked architecture.*
4. **Beta relationships sour on a trust incident.** One fabricated number to a customer costs more than a month of features. *Mitigation: the briefing-validation tripwire + zero-tolerance fix rule + everything dark until proven on your own businesses.*
5. **Single-person engineering.** I am the only engineer; a long outage while something is broken in production is the nightmare scenario. *Mitigation: staging + rollback drill + additive-only migrations make every production state recoverable in minutes; the runbook makes the recovery procedure yours, not just mine.*
6. **Cost creep as flags turn on.** Collaboration + autonomy multiply AI calls. *Mitigation: bus daily caps (built), dedup (built), per-brand alarms (small P2 build), monthly cost review in the routine.*

# Dependencies (summary)

- Staging: none → start immediately on approval.
- Collab Stage 1: Stage 0 ✅; staging recommended first.
- Founder Mode v1: none technically; sequenced after Stage 1 for engineering focus.
- Internal Beta: Founder Mode v1 + Stage 1 enabled internally.
- Collab Stage 2: Stage 1 traffic. Founder Mode v2: Stage 2 data.
- Collab Stage 3: Stages 1–2 proven internally.
- Customer Beta: Internal Beta gate (4 green weeks) + invite codes + cost alarms.
- Launch: readiness checklist 100% + beta exit criteria.

# Estimated effort (engineering, excluding observation windows)

| Build | Estimate |
|---|---|
| Staging environment + runbook | ~1–2 days |
| Collab Stage 1 | ~3–5 days |
| Founder Mode v1 | ~3–4 days |
| Collab Stage 2 + scorecards + activity view | ~4–6 days |
| Founder Mode v2 | ~3–4 days |
| Invite codes + cost alarms | ~1–2 days |
| Collab Stage 3 + Roundtable | ~6–10 days |
| Readiness-checklist builds (runbook, drills, audits) | ~4–6 days spread |

Calendar time is 3–4× these numbers because every milestone carries the full lifecycle (architecture note → build → tests → architect review → completion report → your approval) and the program's pace is set by observation windows, correctly.

# CEO recommendations

1. **Approve staging as the next implementation milestone.** Cheapest insurance we will ever buy; everything after it is safer.
2. **Hold the line on "no new AI features."** The next six months are about trust, instrumentation, and evidence. The feature-suggestion pipeline will keep capturing ideas; the roadmap has a Q3 slot for the winners.
3. **Protect your Monday.** The weekly executive review is where the platform's value compounds and where every gate metric gets read. If you keep one ritual, keep that one.
4. **Treat the field journal as a deliverable.** Your one-line surprise notes during Internal Beta are the highest-signal product input this company will ever get.
5. **Decide beta pricing early with ChatGPT.** Founding-customer terms drafted before the first invitation, per the creative workflow — so the offer is ready the day the metrics are.
6. **Keep the kill-switch culture.** Every flag we've shipped OFF is also an instant OFF in production. That is the real safety net under the whole roadmap.

# Lessons learned from Sage V2 and Department Collaboration (applied above)

1. **Dark-first releases work.** Six Sage phases + Stage 0 shipped to main with zero customer impact. → Every build in this roadmap ships dark; enablement is a separate, watched decision.
2. **The completion-report ritual catches things.** Writing the report against the actual code (not memory) has repeatedly surfaced small drift (flag names, schema details) before you saw it. → Kept for every milestone.
3. **Enforce in code, never in prompts.** Every invariant that mattered (honesty rules, ownership, anti-loop) lives in code/DB constraints. → Founder Mode's validation tripwire and the gap-note-in-code pattern continue this.
4. **Honest emptiness beats fabricated confidence.** NULL-not-0, "insufficient data" states, gap notes — the platform's credibility rests on these. → Trust metrics in Founder Mode make honesty *measurable*.
5. **Adoption gates beat calendars.** Sage V2's outcome-coverage gate (30%/50%) proved that "when the data earns it" is a better scheduler than "when the sprint ends." → The whole roadmap is gated on evidence, not dates.
6. **Architect review earns its cost.** Stage 0's review produced a real hardening (the claim ownership double-check). → Retained at every milestone; heaviest at Stage 3.
7. **Small blunt switches accumulate debt.** `FREE_TEST_MODE` served well but is now the bluntest tool in the platform. → Invite codes scheduled at the moment they're needed, not before.
8. **The tests are the company.** 925 green tests are why we can move fast alone. Every phase above budgets testing as first-class work, and hire #2's job description already says so.

---

*This document is the governing operational document for Zorecho until superseded by a future version (CEO, July 19, 2026). Execution order approved in principle; each implementation milestone still requires its own CEO approval before work begins, and every major milestone is followed by a one-week CEO Operational Validation. Recommended first milestone: Phase 4 (Staging), with Collab Stage 1 queued behind it.*
