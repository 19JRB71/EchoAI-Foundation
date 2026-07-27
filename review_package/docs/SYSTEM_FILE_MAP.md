# SYSTEM_FILE_MAP.md

> **Scope & method.** This map documents the *live* Zorecho application, which
> lives entirely in the `EchoAI/` directory of the repository. Purposes below
> were verified by reading entry points (`EchoAI/server.js`, `config/`,
> `utils/scheduler.js`, `middleware/auth.js`, `utils/runMigrations.js`) and by
> walking the real directory tree. Where a claim could not be verified from the
> code, it is labeled **UNVERIFIED** / **UNKNOWN**.
>
> Generated for the ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE (2026-07-24).
> **No platform code was modified to produce this document.**

---

## 0. Repository-level layout (top level)

The Git repository is a monorepo, but only one directory is the deployed
product. The others are prototypes, mobile clients, tooling, or design
artifacts and are **NOT part of the running Zorecho server**.

| Path | What it is | Active? | Notes |
|---|---|---|---|
| `EchoAI/` | **THE live Zorecho platform** — Node/Express backend + React (Vite) client. Everything the deployed app runs is here. | **Active (production)** | Deployed to Railway. All other docs in this package describe this directory. |
| `EchoAI-Mobile/` | React Native / Expo mobile app scaffold (screens, navigation, API client). | Separate build — **UNVERIFIED** in production | Talks to the `/api/v2*` mobile API. Not part of the web server. |
| `artifacts/api-server/` | A separate small TypeScript Express server (`src/app.ts`, health route). | Prototype / scaffold — **not the live server** | Runs as a Replit workflow named "EchoAI" but is a skeleton, distinct from `EchoAI/server.js`. |
| `artifacts/mockup-sandbox/` | Vite + shadcn/ui component sandbox for design mockups. | Design tooling only | Not shipped to customers. |
| `lib/` | `api-spec`, `api-zod`, `api-client-react`, `db` packages (generated types/schema). | Tooling / **UNVERIFIED** usage by `EchoAI/` | The live app uses raw SQL + hand-written `api.js`, not these generated clients. |
| `scripts/` | Repo build/codegen scripts. | Tooling | |
| `attached_assets/` | Screenshots, pasted prompts, historical briefs. | Reference only | Excluded from the review archive. |
| `screenshots/` | Design review screenshots. | Reference only | |
| `EchoAI/client/` | React SPA (see §3). | **Active** | Built to `client/dist`, served by the Express server. |
| Root docs (`DEPLOYMENT.md`, `DEPLOYMENT_RAILWAY.md`, `CUSTOMER_EXPERIENCE_CONSTITUTION.md`, `COLLAB_STAGE0_COMPLETION_REPORT.md`) | Documentation. | Reference | `DEPLOYMENT_RAILWAY.md` is accurate to the deploy; see `DEPLOYMENT_AND_RECOVERY.md`. |
| Root `railway.toml`, root `nixpacks.toml` | **UNKNOWN precedence.** `EchoAI/railway.toml` and `EchoAI/nixpacks.toml` also exist and are authoritative when the Railway service Root Directory is set to `EchoAI`. | See deployment doc | Documented in `DEPLOYMENT_AND_RECOVERY.md`. |

> ⚠️ **Duplication / potential confusion:** there is a `railway.toml` at the
> repo root AND at `EchoAI/railway.toml`, and the root `DEPLOYMENT_RAILWAY.md`
> shows a *different* build command than `EchoAI/railway.toml` uses. Which one
> Railway reads depends on the service **Root Directory** setting. See
> `DEPLOYMENT_AND_RECOVERY.md` §"Known deployment gotchas".

---

## 1. `EchoAI/` — top-level files

| File | Purpose | Active? |
|---|---|---|
| `server.js` | **Main entry point.** Express app: env validation, CORS, rate limit, session store (PG), mounts ~90 route modules under `/api/*`, serves the SPA from `client/dist`, starts the cron scheduler and admin seeder on boot. | **Active** |
| `package.json` | Backend manifest. `type: commonjs`, Node engine pinned `20.x`. Scripts: `start`, `dev`, `migrate`, `seed`, `build:client`, `start:prod`. | Active |
| `package-lock.json` / `yarn.lock` | Dependency lockfiles. Railway installs with **Yarn** (`--frozen-lockfile`) per `nixpacks.toml`; `package-lock.json` is retained but not used by the Railway install. | `yarn.lock` authoritative on deploy |
| `railway.toml` | Railway build/deploy config for when Root Directory = `EchoAI`: nixpacks builder, `startCommand = "npm run migrate && node server.js"`, healthcheck `/api/health`. | **Active (deploy)** |
| `nixpacks.toml` | Nixpacks recipe: Node 20 + yarn install + verify all deps + verify prebuilt `client/dist`. Client SPA is built locally and committed. | **Active (deploy)** |
| `STAGING_ENV.md` | Staging runbook (domains, env var policy, promotion workflow, smoke pass, rollback). | Reference (accurate) |
| `SUBSYSTEMS.md`, `README.md`, `BACKLOG.md`, `MOBILE_API.md`, `LAUNCH_CHECKPOINT_2026-07-11.md` | Documentation. **Per global rules these are treated as a MAP, not proof.** | Reference |
| `docs/` | Additional internal docs. | Reference |
| `uploads/` | Runtime-written user/AI media (audio, images, media, support, vision). **Ephemeral on Railway** — durable copies are restored from DB (`stored_files`, `vision_reference_images`). Excluded from archive. | Runtime data |

---

## 2. `EchoAI/` — backend folders

### `config/` — configuration & integration clients
Single-responsibility modules read at boot / on demand.

| File | Purpose |
|---|---|
| `db.js` | PostgreSQL `pg` Pool. Uses `DATABASE_URL` (or discrete `DB_*`). Exports `pool`, `query`, `getClient`. Crashes process on pool error. |
| `env.js` | Central env validation. **Critical** vars (`DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`) abort boot if missing; feature vars only warn and degrade gracefully. |
| `environment.js` | Determines `ENVIRONMENT` (`production`/`staging`/`development`). `APP_ENV` wins; else Railway markers → production; else Replit → development. Money-gating depends on this. |
| `anthropic.js`, `openai.js`, `hermes.js`, `elevenlabs.js` | AI provider clients (Anthropic Claude, OpenAI, Nous Hermes, ElevenLabs TTS). |
| `stripe.js` | Stripe client + price IDs. |
| `facebook.js`, `google.js`, `googleCalendar.js`, `jobber.js` | OAuth/integration config for each provider. |
| `fcm.js`, `webpush.js` | Mobile (FCM) + web-push (VAPID) notification config. |
| `twilio.js` | Twilio config (phone/SMS). |
| `aiControls.js` | Background-AI switches + `backgroundAiAllowedHere()` cost gate. |
| `plans.js`, `tiers.js`, `goals.js`, `roiModel.js`, `knowledgeRegistry.js`, `notificationPriority.js`, `webhooks.js`, `webhookEvents.js`, `briefingCopy.js`, `demoScript.js`, `demoSuggestions.js`, `echoVoice.js`, `whiteLabel.js` | Static config / domain constants. |

### `routes/` — Express routers (~90 files)
One router per feature area, each mounted in `server.js` under `/api/<area>`.
Naming is 1:1 with the feature (e.g. `leadRoutes.js` → `/api/leads`,
`sageRoutes.js` → `/api/sage`, `guidedSetupRoutes.js` → `/api/guided-setup`).
Mobile v2 routers: `mobileAuthRoutes.js`, `mobilePushRoutes.js`,
`mobileRoutes.js` under `/api/v2*`. Full mount table is in `server.js`
lines 258–331 and reproduced in `FEATURE_STATUS_MATRIX.md`.

### `controllers/` — request handlers & business logic (~110 files)
The bulk of the backend. Each controller implements the logic for its route
module and typically also exports functions consumed by the scheduler
(e.g. `analyticsController.recordWeeklyAnalyticsForBrand`,
`socialController.publishDuePosts`). Notable ones for the audit:
`authController.js`, `brandDiscoveryController.js` (AI brand research +
auto-save-on-confirm), `guidedSetupController.js`, `socialController.js`
(Facebook publishing), `facebookOAuthController.js`, `sageController.js` /
`sagePhase4/5/6Controller.js` (industry intelligence), `autopilotController.js`,
`echoVoiceController.js`, `phoneController.js` (Twilio), `emailMarketingController.js`,
`subscriptionController.js` (Stripe). See `AGENT_AND_DEPARTMENT_INVENTORY.md`
and `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md` for real-vs-simulated classification.

### `utils/` — shared services & background workers (~100 files)
| Group | Files (examples) | Purpose |
|---|---|---|
| **Scheduling** | `scheduler.js` | Registers ~35 `node-cron` jobs on boot; central automation engine. |
| **AI cost/governance** | `aiBudget.js`, `aiGate.js`, `aiUsage.js`, `aiContext.js`, `spendLimits.js`, `skipGates.js`, `growthGuardrails.js`, `constraintClamp.js`, `apiQuotaMonitor.js` | Token/cost tracking, per-env budget caps, skip gates, workflow context. |
| **Migrations/DB** | `runMigrations.js`, `jsonb.js` | Idempotent SQL migration runner (`schema_migrations` table). |
| **Security** | `encryption.js` (AES-256-GCM token encryption), `token.js`, `intelRedaction.js` | See `SECURITY_AND_PRIVACY_OVERVIEW.md`. |
| **Integrations** | `facebookApi.js`, `socialApi.js`, `sageFacebook.js`, `email.js`/`emailComposer.js`/`emailMonitor.js`/`emailAccounts.js`, `phone.js`, `elevenlabs.js`, `webhookDispatcher.js` | External API wrappers. |
| **Echo/agent brains** | `echoOrchestrator.js`, `echoContext.js`, `echoBriefing.js`, `echoPersonal.js`, `echoSuggestions.js`, `conversationalCore.js`, `autonomousConversationBrain.js`, `collaborationBus.js`, `directiveBus.js` | Agent orchestration & inter-department messaging. |
| **Sage/intel** | `sageContext.js`, `sageStrategy.js`, `sageForecasts.js`, `patternIntelligence.js`, `opportunitySynthesis.js`, `learningEngine.js`, `competitorAdBrain.js`, `competitorAdLibrary.js` | Research/intelligence engines. |
| **Storage** | `storedFiles.js`, `visionFiles.js` | DB-backed durable storage for media (survives ephemeral disk). |
| **Seeding** | `adminSeeder.js`, `demoSeeder.js` | Boot-time admin creation + demo data. |

### `middleware/`
| File | Purpose |
|---|---|
| `auth.js` | JWT verification; resolves platform-admin + team-member workspace remap; session invalidation on password change; beta feature tracking. |
| `admin.js` | Platform-admin gate. |
| `rolePermissions.js`, `whiteLabel.js`, `featureGate.js` | RBAC, agency white-label scoping, tier feature gating. |
| `lockout.js` | Login lockout / brute-force protection. |
| `audioUpload.js`, `documentUpload.js` | Multer upload handlers. |
| `setupConsent.js` | Onboarding consent gate. |

### `models/` — SQL schema & migrations
`schema.sql` (base) + `002_*.sql` … `124_jobber.sql` numbered migrations,
applied in filename order by `runMigrations.js`. **Fully documented in
`DATABASE_MAP.md`.** Some duplicate numeric prefixes exist (e.g. two `054_`,
two `067_`, two `068_`, two `090_`, two `096_`) — flagged in `DATABASE_MAP.md`.

### `prompts/`
AI system/task prompt templates (e.g. `crossBusinessPrompt.js` used by the
scheduler). Enumerated in `AI_PROMPT_INVENTORY.md`.

### `public/`
Static HTML served outside the SPA: `privacy.html`, `data-deletion.html`
(linked from the Facebook app console), and the embeddable
`chatbot-widget.js`.

### `test/` and `tests/`
Node built-in test runner suites (`node --test`). Server tests live in both
`test/**` and `tests/**` (see `package.json` test script). Documented in
`TESTING_CURRENT_STATE.md`.

---

## 3. `EchoAI/client/` — React SPA (Vite)

| Path | Purpose |
|---|---|
| `src/main.jsx` | React entry. |
| `src/App.jsx` | Root shell: auth gate, sidebar, section router (imports every section component; large switchboard). |
| `src/api.js` | Fetch wrapper + token storage (`getToken`/`setToken`/`clearToken`). All client→server calls go through here. |
| `src/sections/` | One component per dashboard feature (Leads, Campaigns, AdStudio, SocialMedia, Sage, Vision, RoiDashboard, Reputation, PhoneAgent, EmailMarketing, ImageStudio, GoogleSeo, Autopilot, etc.) plus nested folders (`billing/`, `crm/`, `email/`, `social/`, `googleseo/`, `image/`, `reputation/`, `roi/`, `sales/`, `video/`, `team/`). |
| `src/admin/` | Admin panel screens (Overview, Customers, Economics, Diagnostics, Health, WhiteLabel, Affiliates, Beta, SalesAgent, SelfReview, Demo, FeatureSuggestions). |
| `src/onboarding/` | Setup Agent + `guided/` Guided Setup Wizard (ConnectionsStep, FirstWinStep, PreviewPanel, etc.) + VoiceCalibration. |
| `src/missioncontrol/` | Mission Control V2 (the live dashboard home). **Legacy `sections/MissionControl.jsx` is retained for reference/rollback — still unit-tested, no longer the live route** (per comment in `App.jsx`). |
| `src/companion/` | EchoCompanion / EchoBrain floating assistant. |
| `src/voice/` | Voice conversation engine, player, calibration, flight recorder, SFX. |
| `src/landing/` | Public landing page + hero demo. |
| `src/tour/` | Guided tour engine + help content. |
| `src/music/` | Login-music widget/context. |
| `src/lib/` | Client-side domain helpers (`departments.js` = the 10-agent registry, `tiers.js`, `goals.js`, `branding.js`, `session.js`, `roles.js`, etc.). |
| `src/components/`, `src/components/ui/` | Shared UI components. |
| `src/design/` | Design preview page. |
| `*.test.jsx` (co-located) | Vitest client tests. |
| `dist/` | **Prebuilt SPA bundle, committed to the repo** (Railway serves this; it is NOT built on Railway). |

### Legacy / duplicate signals found in the client
- `sections/MissionControl.jsx` — **legacy**, superseded by `missioncontrol/MissionControlV2.jsx` (confirmed by comment in `App.jsx`).
- Two `SavedScripts.jsx` / `ScriptGenerator.jsx` families exist under `sections/sales/` and `sections/video/` (intentional — sales scripts vs video scripts), not true duplicates.
- `components/Badge.jsx` and `components/ui/Badge.jsx` both exist (**possible duplication — UNVERIFIED which is canonical**).

---

## 4. Items that appear unused / prototype / not in the live path
- `artifacts/`, `lib/` (generated api-spec/zod/client), `EchoAI-Mobile/` — separate from the deployed web server; their production status is **UNVERIFIED** in this review.
- `sections/MissionControl.jsx` — legacy (retained for rollback).
- `EchoAI/client/dist` — build output, committed intentionally (not source).

---

*Anything not listed above is a leaf file whose purpose follows its folder's
role. Where a folder mixes active and legacy code, it is called out inline.*
