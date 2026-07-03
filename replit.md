# EchoAI

EchoAI is an AI-powered SaaS marketing platform: Facebook/Google ad automation, a
lead-qualification chatbot + embeddable website widget, brand discovery, weekly
analytics & auto-optimization, multi-platform social/video/email/image content
generation & scheduling, SEO tools, reputation management, an AI phone agent, a
sales-script generator, an ROI dashboard, and Stripe billing.

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
- Required env: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`
  (boot fails fast if any is missing). Feature env vars degrade gracefully to
  503 / "not configured" when unset.

## Stack

- Node.js 24, Express 5, CommonJS
- PostgreSQL via `pg` (raw SQL migrations in `models/*.sql` — **no ORM**)
- React + Vite SPA (`client/`), served single-origin by the same server
- AI: Anthropic (`@anthropic-ai/sdk`) for text agents, OpenAI for DALL-E images
- Integrations: Stripe, Twilio, Facebook/Google OAuth, web-push, nodemailer

## Where things live

- `EchoAI/server.js` — Express app; serves the built SPA (static + SPA fallback)
  AND `/api/*` on one origin. Mounts every route, session, CORS, rate limiter.
- `EchoAI/client/` — React + Vite SPA. The customer dashboard is `App.jsx` +
  `sections/*` (one sidebar section per subsystem) + `components/*`.
- `EchoAI/routes/`, `EchoAI/controllers/`, `EchoAI/prompts/`, `EchoAI/utils/`,
  `EchoAI/config/` — API layer, AI prompt builders, helpers, feature-gate config.
- `EchoAI/models/*.sql` — numbered, idempotent migrations (`IF NOT EXISTS`).
- `artifacts/api-server/.replit-artifact/artifact.toml` — repurposed to serve
  EchoAI through the shared proxy at `/` (see Architecture decisions).

## Architecture decisions

- **Served single-origin.** `server.js` serves the built client and the JSON API
  on one port; the client calls the API with relative paths, so no cross-origin
  config is needed.
- **Preview wired through the artifact proxy.** EchoAI is standalone, but the
  preview only renders proxy-registered apps, so the unused starter `api-server`
  artifact was repurposed to run EchoAI at previewPath `/` on port 8080. Its
  `kind` stays `api` (the validator forbids changing kind) but still renders a
  browser preview. The old standalone webview workflows were removed.

## Cross-cutting conventions & invariants

These patterns repeat across subsystems — follow them for any new feature.

- **Auth & lockout.** Most routes require auth + `lockoutCheck` (locked/past-due
  accounts get 403). **Exceptions that bypass lockout on purpose** so a past-due
  user can recover or keep being pulled back: billing-management routes, `/api/push`,
  `/api/google`. Public (no-auth) endpoints: Stripe/Twilio webhooks, OAuth GET
  callbacks, and the embeddable chatbot widget's `GET /config/:id` + `POST
  /chat|/capture`.
- **Ownership.** Brand-scoped resources guard access via `getOwnedBrand(userId,
  brandId)` (404 on foreign brand); update/delete enforce it with a join to
  `brands` on `user_id` (e.g. `USING brands` / `FROM brands b ... WHERE
  b.user_id = $`). Never trust a client-supplied id without this join.
- **AI failures → 502, never mocked.** All AI agents call Anthropic/OpenAI for
  real. Upstream billing/rate/other failures map to **502** with a clear message
  (not a generic 500). No silent fallbacks or placeholder data anywhere.
- **AI output is validated before persistence.** Generators reject empty/malformed
  responses (non-empty strings + non-empty arrays for required fields) so no bad
  data reaches the DB or downstream sends.
- **Secrets encrypted at rest.** Third-party tokens/creds are AES-256-GCM encrypted
  (`utils/encryption.js`) before storage; status endpoints never return tokens.
- **SSRF allowlists (do not regress).** Any client-supplied URL/endpoint used as
  an outbound target is restricted to https + an allowlisted host suffix: Image
  Studio save URLs (`persistImage`) and web-push endpoints
  (`config/webpush.js`), enforced on both save and use.
- **OAuth shape.** Facebook & Google share it: auth-POST `/oauth/initiate` returns
  `{ authUrl }` (JWT in header, never in the URL); no-auth GET `/oauth/callback`
  validates a session CSRF `state`, exchanges the code, encrypts tokens. Requires
  `express-session` + `connect-pg-simple` (Postgres `session` table).
- **Concurrency safety.** Background/recurring work claims rows atomically
  (`SELECT ... FOR UPDATE [SKIP LOCKED]`) and uses transactions + unique-index
  `ON CONFLICT` backstops so overlapping ticks/requests can't double-act
  (scheduled social posts, email-campaign step advance).
- **api.js body convention.** Client `api.js` methods pass **plain objects** as
  `body`; the `request()` wrapper `JSON.stringify`s — double-encoding 400s the UI.
- **OpenAI/DALL-E URLs expire (~1-2h)** → images are downloaded and persisted to
  disk (`uploads/images/`) at save time; the permanent relative URL is stored.

## Subsystem reference

Each is a sidebar section in the dashboard (`client/src/sections/<Name>.jsx`)
backed by a route group. Migrations are numbered `models/NNN_*.sql`.

| Subsystem | Route mount | Notes |
|---|---|---|
| Social media | `/api/social` | brand-scoped encrypted `social_accounts`; node-cron publishes due posts every minute; ig/tiktok/youtube text-only → 422 |
| Video content | `/api/video` | AI video package (hook/scenes/CTA/thumbnail); `video_scripts` |
| Email marketing | `/api/email-marketing` | **Pro-gated.** AI Email Campaign Writer (1 email: 3 subject variations/preview/html+plain) + Drip Sequence Designer (N emails w/ send_delay_days); one-time blasts + automated drips; nodemailer send w/ click-rewrite + open pixel + auto unsubscribe footer; public open/click/unsubscribe (before auth); `email_opt_outs` enforced at every send site; hourly `sendDueDripEmails` cron claims rows `FOR UPDATE SKIP LOCKED`; segments map to leads (all/hot/warm/cold/customers); 4-tab section (Campaigns/Drip/Contacts/Analytics); namespaced `email_marketing_campaigns`+`_emails`+`_recipients`+`email_opt_outs` (037). Legacy `/api/email-campaigns` (014) left intact but no longer surfaced in the UI |
| Image studio | `/api/images` | **Pro-gated.** AI Image Prompt Engineer (Anthropic) designs 5 detailed on-brand prompts (style/palette/composition/mood/lighting/text-overlay) → per-prompt DALL-E 3 generation → 3 variations per prompt (VARIANT_STYLES). 9 purposes (square/landscape/portrait sizing). Brand Style Guide tab (palette/style/mood/personality/audience + Regenerate Brand Prompts). Generate-Image wired into Ad Studio (`facebook_ad`) + Social (platform→purpose). AI-text failures + malformed output → 502. Persisted to disk; `images` + content_description/style_notes (015, 036) |
| Billing | `/api/subscriptions` | Stripe; management routes bypass lockout; `config/plans.js` is the tier source of truth; global payment-failed banner |
| PWA + web push | `/api/push` | installable PWA; `sw.js` in `client/public/`; VAPID env must stay stable; dual-channel hot-lead alerts; `push_subscriptions` (016) |
| Facebook OAuth | `/api/facebook` | "Continue with Facebook" ad-account linking; `facebook_ad_accounts` JSONB (017) |
| Google + SEO | `/api/google`, `/api/seo` | Google OAuth read APIs + SEO content/keyword generator; `seo_content` (018) |
| ROI dashboard | `/api/roi` | real activity × `config/roiModel.js` constants (estimate, with disclaimer); 12-week `roi_snapshots` (019). **Advanced ROI (Enterprise-gated, `/advanced/*`):** multi-channel dollar attribution (Facebook from real analytics; phone/SMS/email from touch records + per-unit cost estimates; website = untouched CRM leads), CPL/CPC/ROI per channel + funnel; AI ROI Analyst (`prompts/roiAnalystPrompt.js`, AI fail→502) writes an exec summary; weekly `roi_advanced_snapshots` upserted by the Monday scheduler (best-effort) + on-demand regenerate; 4-tab client (Overview/Channel Breakdown/Revenue Attribution/History); lower tiers keep basic view + upgrade banner; `roi_advanced_snapshots` (038) |
| Reputation | `/api/reputation` | Google/Facebook review fetch (Yelp manual-only); honest reply posting; `reviews` (020) |
| Phone agent | `/api/phone` | Twilio webhooks return TwiML 200 even on error; inbound routed by E.164 number (global unique); outbound hot-leads only; `twilio_config`+`calls` (021) |
| Website chatbot | `/api/chatbot` | embeddable widget; method-aware CORS; hot-lead alert once per session on non-hot→hot; app-level lead dedup; `chatbot_*` (022) |
| Sales scripts | `/api/sales-scripts` | AI sales-script generator; `sales_scripts` (023) |
| Zapier webhooks | `/api/webhooks` | outbound webhooks; fire-and-forget `triggerWebhook(brandId,event,data)`; SSRF-guarded https targets; retry+timeout+per-attempt logging; `webhooks`+`webhook_delivery_logs` (024) |
| White label | `/api/agencies` | agencies resell EchoAI under own brand; public `GET /branding` themes client by domain; admin creates agencies + overview; owners self-serve settings/customers/revenue; `agencies`+`agency_customers` (025) |
| Affiliate program | `/api/affiliates` | anyone joins + earns 20% of a referred user's FIRST month's payment; public `POST /track/:code` cookie before auth; conversion on Stripe `invoice.payment_succeeded`; admin approve/pay/suspend lifecycle; `affiliates`+`referrals` (026) |
| Mobile API (v2) | `/api/v2/auth`, `/api/v2/push`, `/api/v2` | native iOS/Android backend; lean payloads + cursor pagination + standard envelope `{status,data,message,pagination}`; 30-day JWT + rotating refresh + biometric; FCM push (degrades when `FCM_SERVER_KEY` unset); `refresh_tokens`+`device_tokens` (027). RN/Expo scaffold in root `EchoAI-Mobile/` |
| Content calendar | `/api/content-calendar` | AI generates a month of social posts (frequency × platforms × theme); saved as `draft` social_posts linked to a `content_calendars` row; activate→scheduled, pause→draft; scheduler only auto-publishes calendar posts whose calendar is `active`; `content_calendars`+`social_posts.calendar_id` (028) |
| Ad creative studio | `/api/ad-studio` | AI generates 5 complete ad creative packages/brand (image desc, video script, copy variations, audience, placements); Creative Library + Performance tabs; one-click launch into existing Facebook campaign infra (paused); weekly perf refresh in Monday scheduler; `ad_creatives` (029) |
| Customer feedback | `/api/feedback` | AI Survey Designer (5Q) + Feedback Analyst (30-day report); public server-rendered response page (`/r/:responseId`); 1-10 sentiment scoring; auto-sent after chat/call/weekly; `surveys`+`survey_responses`+`feedback_reports` (030) |
| Team & roles | `/api/team` | owners invite staff by email (48h token) + assign workspace roles (viewer/manager/admin); `middleware/auth.js` remaps an active member's `userId`→owner so all userId-scoped queries become workspace-scoped; seats = 1 owner + active members (auto-bills via `syncSeatItem`); `team_members`+`team_invitations` (032) |
| SMS marketing | `/api/sms` | pro-gated two-way SMS over each brand's own Twilio number; AI writes 5 message variations + auto-replies inbound (TwiML `MessagingResponse`); STOP/START keywords + `sms_opt_outs` (unique brand_id+phone) honored at every outbound site (follow-ups, appointments, feedback → 409/skip); hot-lead alert on non-hot→hot; public `/inbound` webhook (Twilio-signature validated); `sms_campaigns`+`sms_messages`+`sms_opt_outs` (035) |
| Health monitor & support | `/api/health-monitor`, public `/api/public/support` | **All tiers (no featureGate) — it protects the account itself.** Hourly scheduler sweep (`runHourlyHealthSweep`, `0 * * * *`) probes FB/Twilio/Stripe/email/scheduler/tokens/follow-ups/SMS/webhooks for 24h anomalies; safe deterministic auto-fixes only (currently stale `sending` SMS campaigns); persists a `health_checks` row + AI Health Analyst write-up (best-effort on sweep, →502 on user-facing runs). Owner alerted (email + web/mobile push) ONLY on critical/failed-fix AND a real status transition (never every hour). `getStatus`/`getHistory`/`runCheck` are auth+lockout+ownership (`getOwnedBrand`); support routes bypass lockout (past-due users can still ask for help). Support tickets run the AI Screenshot Support agent (Anthropic vision); authed + public (login-screen) variants; base64 screenshot data URLs need a **scoped `express.json({limit:'12mb'})`** on the two support POST routes (global parser skips them by exact path, like the Stripe raw-body bypass) — the default 100 KB limit silently rejects real screenshots. Screenshots persisted to `uploads/support/`. Admin `GET /api/admin/health/accounts` = all-accounts health summary. Client: floating Help & Support widget (2 tabs, stacked above Take-the-Tour), health dot in TopBar (polls status), public widget on Login, enhanced `AdminHealth.jsx`. `health_checks`+`support_tickets` (046) |
| Customer Intelligence | `/api/intelligence` | **Enterprise-gated.** AI strategist synthesizes EVERY channel (`buildIntelligenceProfile`) into a growing **weekly** intelligence profile: `generateIntelligence` → trajectoryScore 1-10 + analysis + exactly 5 ranked data-grounded recommendations + trends[] + 6 insight sections; anchors on prior week for continuity + delta; AI fail/malformed → 502. Monday scheduler runs it **LAST** (freshest data), best-effort. 4-tab section (Brief/Profile/Trends/Applied) under Business group; applied-recommendation log w/ outcome notes; onboarding "warming up" msg for new Enterprise. `customer_intelligence` (UNIQUE brand_id+week_date) + `applied_recommendations` (039) |

**Detailed per-subsystem deep dives live in `EchoAI/SUBSYSTEMS.md`** (one
`### <subsystem>` section each: auth/ownership, AI agents, persistence,
concurrency, routes, migration, and client wiring). The table above is the index;
open that file when working inside a specific subsystem.

### Feature gating & tier enforcement

- **Three active tiers** (the `subscription_tier` enum keeps legacy `free`/`growth`
  defensively, but only these are offered): **Starter $100** (1 seat), **Professional
  $350** (5 seats), **Enterprise $550** (unlimited). Seats beyond the included count
  bill at **$50/seat/month** (`ADDITIONAL_SEAT_PRICE`). `config/plans.js` is the tier
  source of truth (`computeMonthlyTotal`, `additionalSeats`, `seatLimitFor`, hidden
  legacy tiers); `config/tiers.js` holds `FEATURES`, `TIER_RANK`
  (free0 starter1 growth1 pro2 enterprise3), `meetsTier`.
- **Tier read from `subscriptions` = source of truth → instant upgrade unlock.**
  `middleware/featureGate.js` `featureGate(featureKey|tier)` returns **403**
  `{error,feature,currentTier,requiredTier,requiredTierName,requiredMonthlyPrice}`
  when below the required rank; **admin role bypasses all gates**. Order on gated
  routes is always `auth → lockout → featureGate` (never gate before lockout).
- **Pro-gated:** voice (per-route), phone, reputation, sales scripts, content
  calendar, webhooks, video, ad studio, image studio. **Enterprise-gated:** agency, affiliate,
  mobile v2, feedback, customer intelligence. **Social** rejects connecting a 3rd+ platform below Pro
  (`socialController.connectSocialAccount`, admin bypass).
- **Upgrade is instant; downgrade defers to next cycle.** `changeSubscription`:
  upgrade swaps the Stripe price immediately, clears any pending downgrade, and
  resyncs seats; downgrade only sets `pending_tier` + `pending_tier_effective_at`
  (= renewal date), no proration. The pending downgrade is applied in the
  `invoice.payment_succeeded` webhook (per-row users tier update + best-effort
  `syncSeatItem`). Migration `models/031_feature_gating.sql` adds those two columns
  (idempotent).
- **Seat billing.** `syncSeatItem(stripeSubscriptionId, tier, teamSize)` adds/updates/
  deletes a single Stripe seat line item for `additionalSeats(tier,teamSize)` with
  prorations; no-ops gracefully when `STRIPE_PRICE_SEAT` is unset. Applied at
  `createSubscription` (first cycle reflects extra seats), `changeSubscription`
  (upgrade), and `updateTeamSize` (`POST /api/subscriptions/team`, auth-only).
  `getSubscriptionStatus` exposes `teamSize/includedSeats/additionalSeats/
  additionalSeatPrice/monthlyTotal/pendingTier/pendingTierEffectiveAt`.
- **Client mirror.** `client/src/lib/tiers.js` mirrors `PLAN_META`, `TIER_RANK`,
  `meetsTier`, and `SECTION_GATES` (keep in sync with backend). `components/
  FeatureGate.jsx` shows a spinner while tier is unknown, else an upgrade prompt;
  `App.jsx` gates each section + passes tier to `Sidebar.jsx` (lock indicators);
  admin gets `currentTier='enterprise'`. Pricing surfaces (LandingPage Pricing,
  onboarding StepSubscription, Billing seat manager + pending-downgrade note) show
  100/350/550 + the $50/seat note. `api.js` `updateTeamSize`.

## Production hardening

- `config/env.js` `validateEnv()` runs first at boot: throws on missing critical
  vars, warns for feature vars, logs an enabled/disabled feature summary.
- Middleware order: `trust proxy` → `morgan` → `cors` → rate limiter on `/api` →
  JSON parser (webhook-exempt) → urlencoded → session → routes → SPA/static →
  `/api` JSON 404 → global JSON error handler. CORS is permissive in dev,
  restricted to `https://`+`REPLIT_DOMAINS`+`ALLOWED_ORIGINS` in prod.
- **Stripe webhook raw-body bypass** matches `POST` + `req.path ===
  "/api/subscriptions/webhook"` so `express.json()` can't eat the body and break
  signature verification.
- Migration runner `utils/runMigrations.js` applies `models/*.sql` in order in
  per-file transactions, tracks `schema_migrations`, skips applied, fails hard on
  real errors (relies on idempotent migrations).

## Validation

Three registered validation steps gate task completion (see the `validation` skill):

- **`test`** — `cd EchoAI && npm test` (server-side: setup-agent routes/controllers
  + other `test/**` and `tests/**` node:test suites).
- **`client-test`** — `cd EchoAI/client && npm install && npm test`. Runs the
  client's **vitest + @testing-library/react + jsdom** component tests
  (`client/src/**/*.test.{js,jsx}`), e.g. `onboarding/SetupAgent.test.jsx` which
  renders the real `SetupAgent` against a mocked `api` and asserts the visible
  raced-outcome branches (paused panel + Resume button / dismissed → onClose /
  session-less 409 → retryable error banner in the running phase). Self-installs
  its dev deps (needs npm-registry access); config in `client/vitest.config.js`
  + `client/vitest.setup.js`. Complements the pure-logic node:test in
  `tests/setupAgent.executeError.test.js` (which runs under the `test` step).
- **`client-build`** — `cd EchoAI && npm run build:client`. Builds the React SPA
  (`vite build` → `client/dist`) so a broken client (bad import, syntax error,
  failed Vite build) blocks completion instead of shipping a blank/stale
  dashboard (the server serves the pre-built `client/dist`, so a bad build would
  otherwise only surface on the next manual rebuild + workflow restart).
  - **Runner requirement:** `build:client` = `cd client && npm install && npm run
    build`, so it self-installs the client's dev deps (Vite, plugins, Tailwind) on
    a fresh runner and needs network access to the npm registry. No `DATABASE_URL`
    or other server env is required — the build is env-independent. Allow ~1-2 min
    for a cold `npm install` + build.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Rebuild the client after changing `EchoAI/client/`**: `cd EchoAI/client &&
  npm run build`, then restart the `artifacts/api-server: EchoAI` workflow. The
  server serves pre-built `client/dist` (no dev HMR in the preview).
- The artifact's `development.run` runs from the artifact dir, so it uses an
  absolute path (`cd /home/runner/workspace/EchoAI && npm start`).
- If port 8080 is stuck after a failed restart, free it with `fuser -k 8080/tcp`
  before restarting the workflow.

## Pointers

- `EchoAI/README.md` documents every feature, env var, endpoint, and third-party
  connection guide in full detail.
- See the `pnpm-workspace` skill for workspace structure (applies to the
  surrounding monorepo, not to EchoAI itself).
