# ZORECHO ENGINEERING CONSTITUTION

## Version 1.1 — Approved by James (CEO), July 14, 2026

This is the permanent engineering constitution of Zorecho. Every major
architectural decision is evaluated against it. It evolves only through
deliberate, CEO-approved amendments — never implicitly through implementation.

---

# VISION

Zorecho is not a chatbot. Zorecho is an AI company inside software.

Customers experience one unified assistant called Echo. Behind Echo may be many
systems, agents, models, databases, automations, and providers — but the
customer never sees that complexity. Echo always feels like one intelligent
employee.

---

# COMPANY ORGANIZATION

## James — CEO
Vision, strategy, customer relationships, product approval, business decisions,
final authority.

## ChatGPT — Chief Architect & Creative Director
Product architecture and long-term planning, brand identity, marketing
strategy, customer experience, creative direction, advertising, sales
messaging, product positioning, creative prompt philosophy, visual concepts,
launch campaigns. **ChatGPT defines WHAT we build and WHY.**

## Replit / Claude — Chief Engineering Officer
Software architecture implementation, database, APIs, security, infrastructure,
deployment, testing, performance, reliability, voice implementation, AI
integration, production stability, converting approved designs into working
software. **Replit defines HOW we build it.**

## Hermes — Runtime Operations Manager
Exists inside the product. Workflow orchestration, internal routing, agent
coordination, runtime decisions, conversation execution, task delegation.
Hermes manages Echo's internal operations, never company decisions.

---

# CORE ENGINEERING PRINCIPLES

1. Customers interact with one assistant, not multiple AI providers.
2. Provider-specific code stays behind its capability chokepoint (see Provider
   Philosophy).
3. Customer data is always isolated.
4. No paid AI request without measurable value.
5. Prefer deterministic software over LLMs whenever practical.
6. Research once. Reuse many times.
7. Company knowledge and industry knowledge are different.
8. Shared knowledge should benefit every appropriate customer.
9. Background AI must justify its cost.
10. Every AI request must be measurable.
11. Every AI request must be attributable.
12. Every AI request must have a reason.
13. Budgets attach to **features and customers**, not individual requests
    (amended in v1.1 — per-request budgets are bureaucracy; per-feature and
    per-customer limits, like Autopilot's spending limits, are the workable
    unit).
14. Every AI request should be observable.
15. Every feature should have rollback capability.
16. Development never spends production money.
17. Production never depends on development.
18. Simplicity beats cleverness.
19. Reliability beats features.
20. Launch before perfection.
21. Build systems that become MORE efficient as they scale.
22. Technical debt is intentionally accepted, never accidentally created.
23. Reuse knowledge before buying new knowledge.
24. Engineering should reduce future cost, not only solve today's problem.
25. Every architectural decision should answer: **"Will this still be
    REVERSIBLE with one million users?"** (amended in v1.1 — the test is
    reversibility, not correctness-at-scale; choices that are right today and
    changeable later are good engineering, premature complexity is not).

---

# ARTICLE: DATA HONESTY (added in v1.1)

- Never fabricate data. Never fill gaps with plausible-looking numbers.
- Read errors surface as errors — never as "no data" or invented defaults.
- AI failures become visible errors (502), never silent fallbacks or mocked
  output.
- No-data is stored as NULL, not zero.

# ARTICLE: APPROVAL GATES (added in v1.1)

- Nothing spends customer money without explicit owner approval.
- Nothing publishes publicly without explicit owner approval (or an approval
  mode the owner deliberately enabled with guardrails, e.g. Autopilot limits).

# ARTICLE: ISOLATION (added in v1.1)

- Company (customer-specific) knowledge never crosses customer boundaries.
- Industry knowledge is shared deliberately, and the company/industry boundary
  is enforced structurally — in the schema — not by convention.
- Customer tokens are encrypted at rest; ownership is enforced on every query;
  outbound URLs are allowlisted. Customer data is protected by default, not by
  review.

# ARTICLE: MIGRATION DISCIPLINE (added in v1.1)

- Every schema change is an idempotent, ordered, transactional migration.
- Deploys never break databases.

---

# KNOWLEDGE STRATEGY

Zorecho's greatest long-term asset is knowledge. Eventually we build a
centralized Knowledge Hub: Industry Brains, Company Brains, Market
Intelligence, Shared Learning, Versioned Knowledge, Research History.

The Knowledge Hub researches an industry once and distributes relevant
knowledge to all appropriate customers. It never repeatedly purchases the same
information per customer. Knowledge becomes more valuable over time.

**v1.1 constraint:** when the Knowledge Hub is built, the industry/company
isolation boundary (Article: Isolation) is the FIRST thing designed, not the
last.

---

# CREATIVE WORKFLOW

ChatGPT creates → James reviews → James approves → Replit implements.

Approved copy is not rewritten unless technically necessary, legally necessary,
or compliance requires it. If changes are required: explain first, wait for
approval.

# ENGINEERING WORKFLOW

Design → Review → Approval → Implementation → Testing → Deployment →
Observation → Measurement → Improvement. Never skip directly from idea to
production.

---

# COST PHILOSOPHY

Zorecho becomes MORE profitable as it grows. Before every AI call: Can
deterministic software do this? Can cached knowledge do this? Can existing
memory do this? Can a cheaper model do this? Does this request justify spending
money? If no — do not call an LLM.

# OBSERVABILITY (phased in v1.1)

Nothing important is invisible. Phased rollout:

1. **Phase 1 (now):** cost + attribution — which feature, which customer, what
   it cost.
2. **Phase 2:** success/failure tracking per feature.
3. **Phase 3:** avoidability analysis — cache hits, deterministic-replacement
   candidates.

# PROVIDER PHILOSOPHY (amended in v1.1)

Zorecho never depends on one AI provider. Replaceable **at the chokepoint, not
everywhere**: every capability has exactly one chokepoint with a fallback
(e.g. speech synthesis: ElevenLabs → OpenAI; decisions: Hermes → graceful
degradation). Abstraction is required at chokepoints only — universal adapters
over everything are expensive and leak anyway. Customers never know which
provider completed the work.

---

# LONG-TERM GOAL

Zorecho becomes one of the best AI business platforms in the world. That
requires discipline more than speed. Every major engineering decision moves us
toward: greater scalability, greater reliability, lower operating cost, higher
quality, cleaner architecture, better customer experience.

---

# AMENDMENT PROCESS

The Constitution evolves deliberately: proposed changes are explained, reviewed
by James, and approved before taking effect. No implicit amendment through
implementation. Version history:

- **v1.0** — CEO founding directive (July 14, 2026).
- **v1.1** — CEO-approved amendments (July 14, 2026): reversibility test
  replaces 1M-user correctness test; budgets per feature/customer; chokepoint
  provider abstraction; added Articles on Data Honesty, Approval Gates,
  Isolation, Migration Discipline; phased observability.
