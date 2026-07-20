---
name: Zorecho operational roadmap governance
description: Governing operational document + CEO validation cadence rules that gate all future implementation work
---

**Rule:** `ZORECHO_OPERATIONAL_ROADMAP.md` is the CEO-approved governing operational document (July 19, 2026) until superseded. Execution order: Staging → Collab Stage 1 → Founder Mode v1 → Internal Beta → Collab Stage 2 → Founder Mode v2 → Collab Stage 3 → Customer Beta → readiness checklist → launch. Each milestone still needs its own CEO approval.

**CEO Operational Validation (permanent):** after every major implementation milestone, engineering pauses for ONE WEEK while the CEO runs his real businesses through the platform as a customer. Seven written questions (time saved / frustrations / ignored / surprises / most-relied / expected-but-missing / would-I-miss-it) must be answered; they influence the next milestone's priorities before its architecture note is written.

**Customer Value Created:** every roadmap phase (and by extension, future phase-level planning docs) must include a non-technical "Customer Value Created" section (experience, problem solved, why care, trust, retention, measurement).

**Milestone process (CEO-approved order):** Architecture review → Implementation → Testing → Architect self-review → Completion report → CEO approval → CEO Operational Validation. If a validation failure is caused solely by tooling/workflow/task-tracking (not the code under review), the completion report must explicitly classify it as a **Non-Engineering Validation Exception** (CEO refinement, July 19 2026).

**Phase 4 (Staging Environment) status:** engineering approved July 19 2026; Railway staging is LIVE at echoai-foundation-production-edd8.up.railway.app (separate Railway project + fresh Postgres, root dir /EchoAI, branch `staging`, fresh boot secrets, Stripe test keys, DEVELOPMENT_AI_ENABLED=true, $5/day AI cap). Verified remotely: /api/health reports staging + deploy version, X-Robots-Tag noindex present. GitHub: tag `phase4-staging-approved` + `staging` branch created. PENDING before marking Phase 4 complete: CEO's manual smoke checks (amber banner, signup/login on the empty staging DB, one content workflow end-to-end). Staging DB is empty — may need the admin seed command. Then plan Department Collaboration Stage 1. Implementation frozen unless a genuine defect surfaces.

**Why:** CEO directive to shift from governance-writing to execution; he explicitly said to stop creating new planning documents and revise existing ones only when completed milestones give a concrete reason.

**How to apply:** Don't propose new governance/architecture documents unprompted. Before starting any implementation milestone, check the roadmap's order and confirm CEO approval; after completing one, expect the validation week rather than immediately starting the next build.
