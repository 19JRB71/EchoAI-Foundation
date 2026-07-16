# EchoAI

**Customer-facing brand name: "Zorecho"** (rebranded July 2026 — all user-visible
strings, PWA manifest, emails, prompts, and wordmarks say Zorecho; the assistant
persona "Echo", the agent names, and ALL internal identifiers stay unchanged:
`EchoAI/` directory, routes, env vars, lowercase keys like `echoai_chat_session_`,
`echoai-shell-v*` cache names, and the `echoai.com` email domain).

EchoAI is an AI-powered SaaS marketing platform: Facebook/Google ad automation, a
lead-qualification chatbot + embeddable website widget, brand discovery, weekly
analytics & auto-optimization, multi-platform social/video/email/image content
generation & scheduling, SEO tools, reputation management, an AI phone agent, a
sales-script generator, an ROI dashboard, and Stripe billing.

## Stack

- Node.js 24, Express 5, CommonJS
- PostgreSQL via `pg` (raw SQL migrations in `models/*.sql` — **no ORM**)
- React + Vite SPA (`client/`), served single-origin by the same server
- AI: Anthropic (`@anthropic-ai/sdk`) for text agents, OpenAI for DALL-E images
- Integrations: Stripe, Twilio, Facebook/Google OAuth, web-push, nodemailer

## Run & Operate

EchoAI is a **standalone Node/Express (CommonJS) app**, not a pnpm-workspace
package. All commands run from `EchoAI/` with **npm** (not pnpm):

- `npm start` — run the server (`node server.js`, port from `PORT`, default 5000)
- `npm run dev` — run with `--watch` auto-reload
- `npm run migrate` — apply pending `models/*.sql` migrations (idempotent runner)
- `npm run seed` — seed the admin user
- `npm run build` — build the React client (`client/dist`)
- `npm run start:prod` — migrate → build client → start (deploy command)
- Client only: `cd client && npm run build`

**Environment variables**

- Required (boot fails fast if any is missing): `DATABASE_URL`, `JWT_SECRET`,
  `SESSION_SECRET`, `ENCRYPTION_KEY`.
- Feature vars degrade gracefully to 503 / "not configured" when unset:
  `ANTHROPIC_API_KEY`, `NOUS_PORTAL_API_KEY` (Echo's Hermes-4 decision brain —
  missing → Echo falls back to its prior behavior), `OPENAI_API_KEY`, Stripe (`STRIPE_SECRET_KEY`,
  `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_SEAT`), Twilio + `SALES_TWILIO_*`,
  Facebook (`FACEBOOK_APP_ID/SECRET`, `FACEBOOK_ACCESS_TOKEN`), Google OAuth,
  web-push VAPID keys (must stay stable), `FCM_SERVER_KEY`, mail/SMTP,
  `ALLOWED_ORIGINS`, `REPLIT_DOMAINS`.
- `config/env.js` `validateEnv()` runs first at boot: throws on missing critical
  vars, warns for feature vars, logs an enabled/disabled feature summary.

## Where things live

- `EchoAI/server.js` — Express app; serves the built SPA (static + SPA fallback)
  AND `/api/*` on one origin. Mounts every route, session, CORS, rate limiter.
- `EchoAI/client/` — React + Vite SPA. The customer dashboard is `App.jsx` +
  `sections/*` + `components/*`.
- `EchoAI/routes/`, `controllers/`, `prompts/`, `utils/`, `config/` — API layer,
  AI prompt builders, helpers, feature-gate config.
- `EchoAI/models/*.sql` — numbered, idempotent migrations (`IF NOT EXISTS`).
- `artifacts/api-server/.replit-artifact/artifact.toml` — repurposed to serve
  EchoAI through the shared proxy at previewPath `/` on port 8080 (preview only
  renders proxy-registered apps). Its `kind` stays `api` (validator forbids
  changing kind) but still renders a browser preview.

## Cross-cutting conventions & invariants

These patterns repeat across subsystems — follow them for any new feature.

- **Auth & lockout.** Most routes require `auth` + `lockoutCheck` (locked/past-due
  → 403). Bypass lockout on purpose so past-due users can recover: billing routes,
  `/api/push`, `/api/google`. Public no-auth endpoints: Stripe/Twilio webhooks,
  OAuth GET callbacks, chatbot widget `GET /config/:id` + `POST /chat|/capture`.
- **Ownership.** Brand-scoped resources guard access via `getOwnedBrand(userId,
  brandId)` (404 on foreign brand); mutations enforce it with a join to `brands`
  on `user_id`. Never trust a client-supplied id without this join.
- **AI failures → 502, never mocked.** All AI agents call Anthropic/OpenAI for
  real; upstream failures map to 502 (not 500). AI output is validated before
  persistence (non-empty strings/arrays). No silent fallbacks or placeholder data.
- **Secrets encrypted at rest.** Third-party tokens are AES-256-GCM encrypted
  (`utils/encryption.js`); status endpoints never return tokens.
- **SSRF allowlists (do not regress).** Client-supplied outbound URLs are https +
  allowlisted host suffix: Image Studio save URLs (`persistImage`), web-push
  (`config/webpush.js`) — enforced on both save and use.
- **OAuth shape.** FB & Google: auth-POST `/oauth/initiate` returns `{ authUrl }`
  (JWT in header, never the URL); no-auth GET `/oauth/callback` validates a session
  CSRF `state`, exchanges the code, encrypts tokens. Needs `express-session` +
  `connect-pg-simple` (Postgres `session` table).
- **Concurrency safety.** Background/recurring work claims rows atomically
  (`SELECT ... FOR UPDATE [SKIP LOCKED]`) + transactions + unique-index
  `ON CONFLICT` backstops so overlapping ticks can't double-act.
- **api.js body convention.** Client `api.js` methods pass **plain objects** as
  `body`; the `request()` wrapper `JSON.stringify`s — double-encoding 400s the UI.
- **OpenAI/DALL-E URLs expire (~1-2h)** → images are downloaded to disk
  (`uploads/images/`) at save time; the permanent relative URL is stored.

## Subsystems

Each subsystem is a sidebar section (`client/src/sections/<Name>.jsx`) backed by a
route group, with a numbered `models/NNN_*.sql` migration. **Deep dives for the
subsystems below live in `EchoAI/SUBSYSTEMS.md`** (one `### <subsystem>` section
each: auth/ownership, AI agents, persistence, concurrency, routes, migration,
client wiring). Open that file when working inside a specific subsystem.

| Subsystem | Route mount | One-liner |
|---|---|---|
| Social media | `/api/social` | scheduled multi-platform posts; cron publishes due posts |
| Video content | `/api/video` | Pro. AI video script packages |
| Email marketing | `/api/email-marketing` | Pro. AI campaigns + drip sequences; opt-outs |
| Image studio | `/api/images` | Pro. AI prompt engineer → DALL-E 3 on-brand images |
| Billing | `/api/subscriptions` | Stripe subscriptions + seat billing |
| PWA + web push | `/api/push` | installable PWA + hot-lead push alerts |
| Facebook OAuth | `/api/facebook` | ad-account linking |
| Google + SEO | `/api/google`, `/api/seo` | Google OAuth reads + SEO content generator |
| ROI dashboard | `/api/roi` | activity-based ROI estimates; Advanced ROI Enterprise-gated |
| Reputation | `/api/reputation` | Pro. review fetch + honest reply posting |
| Phone agent | `/api/phone` | Pro. Twilio AI receptionist |
| Website chatbot | `/api/chatbot` | embeddable lead-qualifying widget |
| Sales scripts | `/api/sales-scripts` | Pro. AI sales-script generator |
| Zapier webhooks | `/api/webhooks` | Pro. SSRF-guarded outbound webhooks |
| White label | `/api/agencies` | Enterprise. agencies resell under own brand |
| Affiliate program | `/api/affiliates` | Enterprise. referral commissions |
| Mobile API (v2) | `/api/v2` | Enterprise. native app backend; scaffold in `EchoAI-Mobile/` |
| Content calendar | `/api/content-calendar` | Pro. AI month of scheduled posts |
| Ad creative studio | `/api/ad-studio` | Pro. AI ad creative packages |
| Customer feedback | `/api/feedback` | Enterprise. AI surveys + 30-day analysis |
| Team & roles | `/api/team` | staff invites + workspace roles + seat billing |
| SMS marketing | `/api/sms` | Pro. two-way SMS over brand's Twilio number |
| Health monitor & support | `/api/health-monitor`, `/api/public/support` | all tiers; hourly health sweep + AI support |
| AI Sales Agent | `/api/sales-agent` | admin-only; EchoAI's own inbound demo line |
| Customer Intelligence | `/api/intelligence` | Enterprise. weekly AI strategy profile |
| Voter CRM | `/api/supporters` | all tiers; political-campaign brands only (brand_type='political') — supporters + campaign events |
| Beta Program | `/api/admin/beta` | admin-only; capped beta slots + waitlist, activity tracking, inactivity warnings, convert-to-paid |
| Property CRM | `/api/properties` | all tiers; real-estate brands only (brand_type='real_estate') — listings, buyer/seller leads, open houses + Atlas/Nova automations |
| Feature Suggestions | `/api/admin/feature-suggestions` | all tiers via Echo chat; unsupported asks auto-logged + deduped; admin tab sorted by request count |
| Echo Email Assistant | `/api/echo-email` | all tiers, owner-only; multi-account IMAP/SMTP (app passwords), 15-min AI inbox triage, approval-gated drafts, contract review, lead capture |
| Echo Personal Assistant | `/api/echo-assistant` | all tiers, owner-only; voice reminders (voice→SMS fallback) + prioritized tasks, briefing/closing check-ins, auto-tasks from stale hot leads |
| Autonomous Conversations | `/api/autonomous` | all tiers; when a lead replies (SMS/email/chatbot) Echo replies autonomously — Hermes reads intent/state/buying-signal/temperature, Claude writes in brand voice — until book/convert/stop/48h silent. Strong buying signal → owner voice+SMS alert; owner "transfer it" → seamless handoff |
| Autopilot Mode | `/api/autopilot` | Pro (content_calendar gate); weekly AI content+ad batch → owner approve/decline/revise queue with spend limits; Learning Engine records every decision, Monday-05:00 study distills them into learnings (fed back into prompts) + clarifying questions surfaced in the briefing/Autopilot card |
| Echo Self-Review | `/api/admin/self-review` | admin-only; Monday 07:15 Sage studies the past week's REAL platform data (failures, feedback, feature asks, quotas, learning signals, adoption) → evidence-based ranked improvement recommendations. Recommendation-only — changes nothing; admin triages items (new/planned/dismissed/done) |
| Competitor Ad Spy | `/api/competitor-ads` | Enterprise (Scout); every 6h scans each CONFIRMED competitor's live Facebook ads, Hermes classifies threat, aggressive new ad → owner voice+SMS alert, weekly Claude ad-intelligence report + counter-campaign drafts. No FB token → no-op/empty (nothing fabricated); snapshot is a link |
| Guided Setup Wizard | `/api/guided-setup` | all tiers, owner-only; new-customer front door (Welcome → Plan → Business Profile via embedded Setup Agent → Connect Accounts → Team → Done); server-side save/resume, live connection probes (unknown on failure, never fabricated), static SVG OAuth previews, plain-English OAuth error translation, "Help Me" screenshot rescue (Anthropic vision, honest low-confidence → support escalation). Client: `client/src/onboarding/guided/` |

The dashboard nav is team-member-centric: the sidebar lists the 10 AI agents
(Echo/Scout/Atlas/Nova/Pulse/Voice/Forge/Sentinel/Sage/Vision) + Mission Control; clicking an
agent opens a Department View whose tool cards open these existing sections
unchanged. See `client/src/lib/departments.js` for the agent→section mapping.

## Feature gating & tiers

- **Three active tiers** (`config/plans.js` is the source of truth): **Starter
  $100** (1 seat), **Professional $350** (5 seats), **Enterprise $550**
  (unlimited). Extra seats bill **$50/seat/month** (`ADDITIONAL_SEAT_PRICE`).
  `config/tiers.js` holds `FEATURES`, `TIER_RANK`, `meetsTier`.
- **Tier read from `subscriptions` = source of truth → instant upgrade unlock.**
  `middleware/featureGate.js` returns 403 when below the required rank; **admin
  bypasses all gates**. Route order is always `auth → lockout → featureGate`.
- **Pro-gated:** voice, phone, reputation, sales scripts, content calendar,
  webhooks, video, ad studio, image studio, email, SMS. **Enterprise-gated:**
  agency, affiliate, mobile v2, feedback, customer intelligence. **Social** rejects
  a 3rd+ platform below Pro.
- **Upgrade instant; downgrade defers to next cycle.** Upgrade swaps the Stripe
  price immediately + resyncs seats; downgrade sets `pending_tier` +
  `pending_tier_effective_at`, applied in the `invoice.payment_succeeded` webhook.
- **Seat billing.** `syncSeatItem` maintains one Stripe seat line item; applied at
  create/upgrade/team-size changes; no-ops when `STRIPE_PRICE_SEAT` is unset.
- **Client mirror.** `client/src/lib/tiers.js` mirrors `PLAN_META`, `TIER_RANK`,
  `meetsTier`, `SECTION_GATES` (keep in sync with backend). `FeatureGate.jsx` shows
  the upgrade prompt; admin gets `currentTier='enterprise'`.

## Production hardening

- Middleware order: `trust proxy` → `morgan` → `cors` → `/api` rate limiter →
  JSON parser (webhook-exempt) → urlencoded → session → routes → SPA/static →
  `/api` JSON 404 → global JSON error handler. CORS permissive in dev, restricted
  to `https://` + `REPLIT_DOMAINS` + `ALLOWED_ORIGINS` in prod.
- **Stripe webhook raw-body bypass** matches `POST` + exact
  `req.path === "/api/subscriptions/webhook"` so `express.json()` can't break
  signature verification. (Support screenshot routes similarly need a scoped
  `express.json({limit:'12mb'})` + global-parser skip.)
- Migration runner `utils/runMigrations.js` applies `models/*.sql` in order in
  per-file transactions, tracks `schema_migrations`, fails hard on real errors.

## Validation

Three registered validation steps gate task completion (see the `validation` skill):

- **`test`** — `cd EchoAI && npm test` (server-side node:test suites).
- **`client-test`** — `cd EchoAI/client && npm install && npm test` (vitest +
  @testing-library/react + jsdom; self-installs dev deps, needs npm-registry access).
- **`client-build`** — `cd EchoAI && npm run build:client` (`vite build` →
  `client/dist`; self-installs client dev deps; env-independent; allow ~1-2 min cold).

## User preferences

- **Engineering Constitution.** `ENGINEERING_CONSTITUTION.md` (v1.1, CEO-approved
  July 2026) is Zorecho's permanent engineering constitution. Evaluate major
  architectural decisions against it. It changes only by deliberate CEO-approved
  amendment — never implicitly through implementation.
- **Operating model (established July 2026).** Zorecho runs like a company:
  James = CEO (vision, approvals, final say); ChatGPT = Creative Director
  (Zorecho branding, marketing, ads, website/sales/email copy, visual direction,
  creative strategy for customer-marketing features); Replit/Claude = Lead
  Software Engineer (all code, architecture, DB, security, testing, deployment,
  AI/prompt integration, guardrails, pipelines); Hermes = in-product runtime
  orchestrator only (not a company-level coordinator). Creative workflow for
  anything customer-facing: ChatGPT drafts → James approves → Replit implements
  **exactly as approved** — never rewrite approved copy unless there's a
  technical limitation or legal/compliance issue, and explain before changing.
  The deployed application is the technical source of truth; if creative
  direction conflicts with the implementation, explain the conflict, recommend
  the safest solution, and wait for James's approval before changing behavior.
- **Always remind the user to hit "Push" in the Git panel** whenever a change
  needs to reach the live site. This project deploys to Railway from GitHub
  `main`; the user (non-technical, address as James/Sir) pushes manually via the
  Replit Git panel — the agent cannot push. After ANY code change that must go
  live, end the response with a clear reminder to open the Git panel and Push
  (note whether it's server-only or needs a client rebuild first).

## Gotchas

- **Rebuild the client after changing `EchoAI/client/`**: `cd EchoAI/client &&
  npm run build`, then restart the `artifacts/api-server: EchoAI` workflow. The
  server serves pre-built `client/dist` (no dev HMR in the preview).
- **Stale bundle**: `server.js` serves `index.html` with `Cache-Control:
  no-cache` and hashed `assets/*` as `immutable`. If a shipped client feature
  "does nothing" (its API endpoints never appear in the server log), the browser
  is on an old cached bundle — hard-refresh once. Never make `index.html`
  cacheable or new builds silently won't load.
- The artifact's `development.run` runs from the artifact dir, so it uses an
  absolute path (`cd /home/runner/workspace/EchoAI && npm start`).
- If port 8080 is stuck after a failed restart, free it with `fuser -k 8080/tcp`
  before restarting the workflow.

## Pointers

- `EchoAI/README.md` — every feature, env var, endpoint, and third-party
  connection guide in full detail.
- `EchoAI/SUBSYSTEMS.md` — per-subsystem deep dives (see Subsystems above).
- The `pnpm-workspace` skill covers the surrounding monorepo (not EchoAI itself).
