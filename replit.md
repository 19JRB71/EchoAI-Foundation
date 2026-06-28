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
| Email marketing | `/api/email-campaigns` | 3–10 email sequence; transactional `sendCampaign` (no double/skip); `email_campaigns`+`email_sends` (014) |
| Image studio | `/api/images` | DALL-E 3 (`n=1` ×3 for variations); persisted to disk; `images` (015) |
| Billing | `/api/subscriptions` | Stripe; management routes bypass lockout; `config/plans.js` is the tier source of truth; global payment-failed banner |
| PWA + web push | `/api/push` | installable PWA; `sw.js` in `client/public/`; VAPID env must stay stable; dual-channel hot-lead alerts; `push_subscriptions` (016) |
| Facebook OAuth | `/api/facebook` | "Continue with Facebook" ad-account linking; `facebook_ad_accounts` JSONB (017) |
| Google + SEO | `/api/google`, `/api/seo` | Google OAuth read APIs + SEO content/keyword generator; `seo_content` (018) |
| ROI dashboard | `/api/roi` | real activity × `config/roiModel.js` constants (estimate, with disclaimer); 12-week `roi_snapshots` (019) |
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
  calendar, webhooks, video, ad studio. **Enterprise-gated:** agency, affiliate,
  mobile v2, feedback. **Social** rejects connecting a 3rd+ platform below Pro
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
