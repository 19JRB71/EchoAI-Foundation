# START HERE — Zorecho Full System Review Package

**Package:** ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24
**Prepared:** 2026-07-24
**Represents:** git commit `ae50e8a648f806642f9eb9ab1d7b53a74cf118e4` (branch `main`, 2026-07-24)
**Production code was NOT modified to prepare this package.**

## What Zorecho is

Zorecho (internal codename EchoAI) is an AI-powered SaaS marketing platform for small businesses: Facebook/Google ad automation, a lead-qualification chatbot + embeddable widget, brand discovery, multi-platform content generation and scheduling, SEO tools, reputation management, an AI phone agent, email/SMS marketing, CRM verticals (real estate, political), an always-on voice assistant ("Echo") with 10 named AI agents, and Stripe subscription billing (Starter $100 / Professional $350 / Enterprise $550).

## Technology stack (verified)

- Backend: Node.js, Express, CommonJS — single process serving both `/api/*` and the pre-built SPA (`EchoAI/server.js`)
- Frontend: React 18 + Vite SPA (`EchoAI/client/`)
- Database: PostgreSQL via `pg`, raw SQL migrations (`EchoAI/models/*.sql`) — no ORM
- AI: Anthropic Claude (text), Hermes 4 via Nous Portal (decision brain), OpenAI (Whisper/TTS/images), ElevenLabs (voice)
- Integrations: Stripe, Twilio, Facebook Graph, Google OAuth APIs, web-push, nodemailer/IMAP, Jobber, YouTube Data
- Deployment: Railway (nixpacks + Yarn), branch `main` → app.zorecho.com (production), branch `staging` → staging.zorecho.com (staging); development happens on Replit

## Truthfulness standard used throughout

Every functional claim in these documents required verification against the current code. Labels used consistently: **UNVERIFIED**, **PARTIALLY IMPLEMENTED**, **UI ONLY**, **SIMULATED**, **UNKNOWN**, and for external side effects, **Real but untested**. A screen, success message, or database record was never accepted as proof that an external action occurs. The only externally verified integration as of this date is Google OAuth connect on staging (verified end-to-end by the CEO, 2026-07-23).

## Package contents

- `source/` — complete application source (server + client + tests + migrations + prompts), excluding node_modules, build output, uploaded media, and secrets
- `docs/` — the 21 review documents below

## Recommended reading order

1. `docs/CURRENT_SYSTEM_ARCHITECTURE.md` — stack + data flow (with flagged breaks)
2. `docs/SYSTEM_FILE_MAP.md` — where everything lives
3. `docs/REAL_ACTIONS_VS_SIMULATED_ACTIONS.md` — **the most important honesty document**: what actually reaches the outside world
4. `docs/FEATURE_STATUS_MATRIX.md` — status of every feature
5. `docs/AGENT_AND_DEPARTMENT_INVENTORY.md` + `docs/AI_PROMPT_INVENTORY.md` — the AI layer
6. `docs/AUTOMATION_AND_BACKGROUND_JOBS.md` — all 42 scheduled jobs
7. `docs/DATABASE_MAP.md` (~180 tables) and `docs/ENVIRONMENT_AND_INTEGRATIONS.md` (+ `docs/env.example`)
8. `docs/ONBOARDING_CURRENT_STATE.md` + `docs/CURRENT_USER_JOURNEY.md`
9. `docs/TESTING_CURRENT_STATE.md` — includes fresh 2026-07-24 runs: 951/951 server, 385/385 client
10. `docs/SECURITY_AND_PRIVACY_OVERVIEW.md`, `docs/AI_AND_INFRASTRUCTURE_COST_MAP.md`, `docs/DEPENDENCY_REPORT.md`
11. `docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, `docs/OPEN_TECHNICAL_QUESTIONS.md`
12. `docs/RECENT_DEVELOPMENT_HISTORY.md`, `docs/DEPLOYMENT_AND_RECOVERY.md`

## How to navigate the code

- Entry point: `source/EchoAI/server.js` (route mounts, middleware order, scheduler start)
- API layer: `source/EchoAI/routes/` → `controllers/`
- AI prompts: `source/EchoAI/prompts/` (44 files) + inline prompts in controllers (see AI_PROMPT_INVENTORY.md)
- Automation: `source/EchoAI/utils/scheduler.js` (single in-process cron registrar, 42 jobs)
- Onboarding: `source/EchoAI/client/src/onboarding/` + `/api/guided-setup` routes
- Agent/section mapping: `source/EchoAI/client/src/lib/departments.js`
- Campaign/advertising: `source/EchoAI/controllers/` Facebook campaign + ad-studio + autopilot controllers
- Integrations: grep the integration name in `utils/` and `controllers/`; env vars in `docs/ENVIRONMENT_AND_INTEGRATIONS.md`
- Migrations: `source/EchoAI/models/` in numeric order (note: some duplicate number prefixes exist — see KNOWN_ISSUES)
- Legacy vs active: see SYSTEM_FILE_MAP.md (e.g. legacy `sections/MissionControl.jsx` vs active `missioncontrol/MissionControlV2.jsx`)

## Known limitations of this package

- No live-production database dump is included (privacy); DATABASE_MAP.md documents the schema from migrations.
- Uploaded media (`EchoAI/uploads/`) is excluded (size + privacy).
- `node_modules` and build output are excluded; lock files are included so dependencies are reproducible.
- Cost figures are code-level estimates, never billed actuals (see AI_AND_INFRASTRUCTURE_COST_MAP.md).
- External side effects were not exercised live during preparation (no money spent, nothing published).
- Documentation was produced 2026-07-24 against the commit above; later commits are not reflected.
