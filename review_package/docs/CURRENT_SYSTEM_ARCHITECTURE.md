# CURRENT_SYSTEM_ARCHITECTURE.md

> **Method.** Verified against `EchoAI/server.js`, `config/db.js`,
> `config/env.js`, `config/environment.js`, `middleware/auth.js`,
> `utils/scheduler.js`, `utils/runMigrations.js`, `package.json`, and
> `client/package.json`. Unproven claims are labeled **UNVERIFIED** /
> **UNKNOWN**. **No platform code was modified to produce this document.**
> Generated 2026-07-24.

---

## 1. Stack at a glance

| Layer | Technology (verified) | Evidence |
|---|---|---|
| **Frontend** | React 18.3 SPA, Vite 5 build, React Router 6, Tailwind 3, lucide-react icons, Stripe.js. | `EchoAI/client/package.json`, `client/src/main.jsx`, `App.jsx` |
| **Backend** | Node.js (engine pinned `20.x`), Express 4.21, CommonJS. | `EchoAI/package.json`, `server.js` |
| **Database** | PostgreSQL via `pg` Pool; raw SQL migrations (no ORM). | `config/db.js`, `models/*.sql`, `utils/runMigrations.js` |
| **Sessions** | `express-session` + `connect-pg-simple` (session rows stored in the `session` table in Postgres). Used mainly for OAuth CSRF `state`. | `server.js` L228–245 |
| **Auth** | Stateless **JWT** (`jsonwebtoken`) in `Authorization: Bearer` header. | `middleware/auth.js` |
| **AI providers** | Anthropic Claude (`@anthropic-ai/sdk`), OpenAI (`openai` — images/TTS), Nous **Hermes** (decision brain, via `NOUS_PORTAL_API_KEY`), ElevenLabs (TTS). | `config/anthropic.js`, `openai.js`, `hermes.js`, `elevenlabs.js`, `env.js` |
| **Payments** | Stripe (`stripe` v17). | `config/stripe.js`, `subscriptionController.js` |
| **Telephony/SMS** | Twilio (`twilio` v6) — phone agent + SMS + dedicated Sales Twilio line. | `config/twilio.js`, `phoneController.js`, `smsMarketingController.js` |
| **Social/Ads** | Facebook (`facebook-nodejs-business-sdk` v21) — OAuth + Graph publish + Ad Library. | `utils/facebookApi.js`, `socialController.js`, `facebookOAuthController.js` |
| **Google** | Google OAuth (Business Profile, Ads, Analytics, Search Console). | `config/google.js`, `googleController.js` |
| **Email** | Outbound SMTP via `nodemailer`; inbound IMAP via `imapflow` + `mailparser` (Echo email assistant). | `utils/email.js`, `emailMonitor.js`, `emailAccounts.js` |
| **Notifications** | Web push via `web-push` (VAPID); mobile push via Firebase Cloud Messaging (`FCM_SERVER_KEY`). | `config/webpush.js`, `config/fcm.js`, `pushController.js`, `mobilePushController.js` |
| **Scheduling / background jobs** | `node-cron` — ~35 jobs registered in-process on server boot. | `utils/scheduler.js` |
| **File / media storage** | Local disk under `uploads/` **plus** durable DB copies (`stored_files`, `vision_reference_images`) restored on read because Railway disk is ephemeral. | `server.js` L333–369, `utils/storedFiles.js`, `utils/visionFiles.js` |
| **Other** | Jobber (OAuth CRM), YouTube Data API (music search), `pdf-parse`, `multer` (uploads), `express-rate-limit`, `morgan` (logging). | `config/jobber.js`, `package.json` |
| **Deployment** | Railway (nixpacks builder, Yarn install), single service serves API + SPA. | `railway.toml`, `nixpacks.toml`, `DEPLOYMENT_AND_RECOVERY.md` |

---

## 2. Runtime topology

**Single Node process, single origin.** `server.js` serves:
- `/api/*` — ~90 mounted routers (REST/JSON).
- `/api/v2*` — the lean mobile API.
- `/uploads/*` — media (disk, with DB fallback restore).
- `/privacy`, `/data-deletion` — static legal HTML for the Facebook app console.
- Everything else (GET, non-file) — the React SPA `index.html` (client-side routing).

There is **no separate worker process, no external queue/broker, no Redis, no
message bus**. Background work runs as `node-cron` jobs **inside the same web
process** (`startScheduler()` is called from the `app.listen` callback,
`server.js` L462). Implication: automation only runs while the web dyno is up;
if the single Railway instance is down or scaled to zero, no cron jobs fire.
There is a lightweight in-DB **job-queue path** (`utils/jobQueue.js`, `FOR
UPDATE SKIP LOCKED` claims) but it is **flag-gated (`SAGE_V2_JOB_QUEUE`, default
OFF)** and, even when on, drains synchronously in the same process
(`scheduler.js` `runSageSweepViaQueue`).

### Environment detection (money-critical)
`config/environment.js` resolves the environment in this order: `APP_ENV`
(wins) → Railway markers → Replit markers → `NODE_ENV` → default development.
Background/paid AI is **production-only unless explicitly enabled**
(`DEVELOPMENT_AI_ENABLED` + `AI_BUDGET_DEV_DAILY_USD` on staging). This is the
central cost guard; see `AI_AND_INFRASTRUCTURE_COST_MAP.md`.

### Request middleware order (verified, `server.js`)
`trust proxy` → noindex header (non-prod) → morgan logging → CORS (allowlist +
open public chatbot widget endpoints) → rate limit on `/api` (default 1000 /
15 min) → per-request AI workflow context → conditional JSON body parse (raw
for Stripe webhook, large limit for support/upload paths) → urlencoded → PG
session → health route → feature routers → static SPA → SPA fallback → JSON 404
for unknown `/api` → global JSON error handler.

---

## 3. Authentication & authorization
- **Login** issues a JWT signed with `JWT_SECRET`. Client stores it (see `client/src/api.js`) and sends it as a Bearer token.
- `middleware/auth.js` verifies the token, then:
  - resolves **platform-admin** (`users.role = 'admin'`),
  - remaps the **effective workspace** for active **team members** (`req.user.userId` becomes the account owner's id, so all owner-scoped queries transparently work for invited team members),
  - enforces **session invalidation on password change** (`password_changed_at` vs token `iat`).
- RBAC beyond this is enforced by `middleware/rolePermissions.js`, `admin.js`, `featureGate.js` (tier gating), and `whiteLabel.js` (agency scoping). See `SECURITY_AND_PRIVACY_OVERVIEW.md`.

---

## 4. External services / third parties (summary)
AI: Anthropic, OpenAI, Nous/Hermes, ElevenLabs. Payments: Stripe. Telephony:
Twilio (+ dedicated Sales line). Social/Ads: Facebook/Instagram Graph + Ad
Library. Google: Business Profile / Ads / Analytics / Search Console. CRM:
Jobber. Email: SMTP (out) + IMAP (in). Push: VAPID web-push + Firebase FCM.
Media: YouTube Data API (search). Per-integration live/tested/limitation status
is in `ENVIRONMENT_AND_INTEGRATIONS.md`; real-vs-simulated action classification
is in `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`.

---

## 5. Data-flow explanation (intended pipeline vs. observed code)

The spec asks for a written data flow:
**User input → onboarding → business profile → department heads → individual
agents → generated work → approval → publishing/execution → results →
reporting.** Below is how this maps onto the actual code, with breaks flagged.

1. **User input / signup** — `authRoutes` → `authController` creates a user
   (JWT issued). ✅ verified route exists.
2. **Onboarding** — Guided Setup Wizard (`client/src/onboarding/guided/`) drives
   `/api/guided-setup` (`guidedSetupController.js`) and the Setup Agent
   (`/api/setup-agent`). Brand discovery is AI-driven
   (`brandDiscoveryController.js`, includes auto-save-on-confirm added
   2026-07-24). Full trace in `ONBOARDING_CURRENT_STATE.md`.
3. **Business profile** — persisted to the `brands` table (and related brand
   tables: taglines, geo targeting, online presence, company truth). Most
   feature queries are scoped by `brand_id`/`user_id`. ✅ central object.
4. **Department heads → agents** — the "10 agents" are defined **client-side**
   in `client/src/lib/departments.js`; server-side "agent" behavior is a set of
   controllers + prompt-driven orchestration (`utils/echoOrchestrator.js`,
   `directiveBus.js`, `collaborationBus.js`, Sage controllers). **There is no
   single formal in-code "department head → agent" object graph** — the chain of
   command is expressed through prompts, the collaboration bus, and per-feature
   controllers. ⚠️ **This is an area of uncertainty; see
   `AGENT_AND_DEPARTMENT_INVENTORY.md`.**
5. **Generated work** — AI calls (Anthropic/OpenAI/Hermes) produce content
   (social posts, ads, emails, scripts, images, briefings) written to
   feature-specific tables (e.g. `social_posts`, `ad_creatives`,
   `email_campaigns`, `images`, `video_scripts`). Governed by AI cost gates
   (`utils/aiGate.js`, `aiBudget.js`).
6. **Approval** — approval gating exists per feature (e.g. autopilot items,
   content calendar posts). ⚠️ **Approval is NOT uniform across the platform**;
   which actions require human approval vs. auto-execute must be verified per
   feature — see `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`.
7. **Publishing / execution** — external side effects fire through the
   integration wrappers: `socialController.publishDuePosts` (Facebook Graph),
   `emailMarketingController` (nodemailer), `phoneController` (Twilio),
   `subscriptionController` (Stripe), push controllers. **Per the global
   truthfulness rule, live external delivery is "Real but untested" in
   production unless proven** — see `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`.
8. **Results** — outcomes recorded (analytics rows, ROI snapshots, lead
   outcomes, send-attempt logs). Refreshed by scheduled jobs.
9. **Reporting** — weekly analytics/report/ROI/intelligence jobs
   (`scheduler.js` `runWeeklyAnalytics`) email owners, push notify, and fire
   outbound webhooks.

### Breaks & uncertainties in the flow (explicit)
- **Background work is coupled to the single web process** (no dedicated worker/queue by default). If the instance sleeps or restarts, cron windows can be missed. Jobs are best-effort and log-only on per-brand failure.
- **The "department head → agent" hierarchy is conceptual/prompt-level, not a verifiable code object graph.** UNVERIFIED that work formally routes head→agent as depicted in product docs.
- **Approval gates are per-feature, not global.** Some scheduled jobs generate *and* act (e.g. real-estate content runs, due-post publishing) — the human-in-the-loop boundary varies by feature and must be verified individually.
- **External delivery is not proven end-to-end in production** for FB publish, Twilio calls/SMS, email sends, Stripe charges (Google OAuth connect *was* verified on staging 2026-07-23 per the global rules; FB staging connect not yet tested).
- **Media persistence is ephemeral-disk + DB-restore**; a file missing from both disk and DB 404s (e.g. old DALL·E URLs). This is handled but is a fragile path.

---

## 6. Monitoring & logging
- `morgan` request logging (combined in prod, dev format locally).
- Console-level error logging throughout (per-brand job failures are `console.error`'d and swallowed so one brand can't stop a sweep).
- In-app health: `/api/health` (Railway healthcheck) + `healthMonitorController` hourly sweep + admin Diagnostics/Health screens.
- **No external APM/error-tracking service (e.g. Sentry) is wired in the verified code.** UNVERIFIED that any third-party monitoring exists.

---

## 7. Realtime / queues / webhooks
- **Realtime:** No WebSocket/SSE server found in the verified code; the client polls REST endpoints. (Voice uses request/response audio, not a socket.) UNVERIFIED any push-based realtime channel.
- **Queues:** Only the optional in-DB `jobQueue` (flag-gated, drains in-process). No external broker.
- **Webhooks — inbound:** Stripe webhook (`/api/subscriptions/webhook`, raw body, signature-verified). Other inbound provider webhooks: **UNKNOWN/verify per route** (e.g. `webhookRoutes.js`, Twilio callbacks in `phoneRoutes`).
- **Webhooks — outbound:** Zapier-style outbound webhooks (`utils/webhookDispatcher.js`, `zapierController.js`) fired from scheduled jobs.

---

*Cross-references: deployment specifics → `DEPLOYMENT_AND_RECOVERY.md`;
env vars & integrations → `ENVIRONMENT_AND_INTEGRATIONS.md`; schema →
`DATABASE_MAP.md`; automation → `AUTOMATION_AND_BACKGROUND_JOBS.md`.*
