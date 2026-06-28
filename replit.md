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

### Sales scripts subsystem (`/api/sales-scripts`)

- **Auth + lockout.** `POST /generate`, `POST /` (save), `GET /:brandId` (list),
  `PUT /:scriptId` (edit), `DELETE /:scriptId`. Ownership via `getOwnedBrand` and
  `USING brands` / `FROM brands b ... b.user_id` joins on update/delete.
- The AI agent (`prompts/salesScriptPrompt.js`, Anthropic) takes a brand + a
  `saleType` (**cold_call / warm_follow_up / in_person_meeting**) + target persona
  + desired outcome and returns a structured JSON package: `opening`,
  `discoveryQuestions[]`, `pitch`, `objectionHandling[]`, `closingTechniques[3 —
  soft/medium/direct]`, `followUpSequence[3 — day/channel/message]`. Output is
  trimmed-then-validated (non-empty `opening`/`pitch` + all 4 arrays non-empty);
  upstream AI failures → **502**.
- Brand-scoped `sales_scripts` (`script_content` JSONB, `status` draft|published),
  migration `models/023_sales_scripts.sql`. Dashboard section
  `sections/SalesScripts.jsx` + `sections/sales/*` with two tabs (Script
  Generator, Saved Scripts).

### Zapier webhooks subsystem (`/api/webhooks`)

- **Outbound only.** EchoAI POSTs JSON event payloads to user-registered URLs
  (Zapier catch hooks, Make, Slack, etc.). No inbound Zapier actions.
- **Auth + lockout.** `POST /` (create), `POST /test` (send sample payload),
  `GET /:brandId` (list active), `DELETE /:webhookId`. Ownership via
  `getOwnedBrand(userId, brandId)` and `USING brands ... b.user_id` joins.
- **Event catalog is the source of truth.** `config/webhookEvents.js` lists the
  11 subscribable events + `isValidEvent`. The client dropdown mirrors this list
  (keep in sync). `createWebhook` rejects unknown events (400).
- **SSRF guardrail (do not regress).** `config/webhooks.js`: client-supplied
  webhook URLs must be `https`; internal hostnames (`localhost`/`.local`/
  `.internal`) and private/reserved IP literals are rejected at create time
  (`isAllowedWebhookUrl`), and re-validated at dispatch with DNS resolution
  (`assertSafeWebhookTarget` rejects names resolving to private addresses).
  Residual DNS-rebinding TOCTOU is acknowledged in-code (not closed).
- **Dispatcher.** `utils/webhookDispatcher.js` `deliver()`: 3 attempts, 10s
  `AbortSignal.timeout`, backoff `[0,1000,3000]`, logs **every** attempt to
  `webhook_delivery_logs`, never throws.
- **triggerWebhook is fire-and-forget.** `controllers/zapierController.js`
  `triggerWebhook(brandId, event, data)` looks up active subs and fans out via
  `deliver()`; it catches all errors and is called **without `await`** from
  emitting controllers so it never blocks the request/response. The `POST /test`
  route is the one place delivery is awaited → returns **502** on non-2xx.
- **Events emitted automatically:** `new_lead_created` (leadController),
  `lead_temperature_hot` (websiteChatbotController), `weekly_report_generated`
  (scheduler), `inbound_call_received` + `outbound_call_completed`
  (phoneController), `new_review_received` (reputationController). The remaining
  catalog events are subscribable but not yet wired to an emitter.
- Migration `models/024_webhooks.sql`; dashboard section
  `client/src/sections/ZapierIntegration.jsx`.

### White-label agency subsystem (`/api/agencies`)

- **Two audiences.** Platform owner (admin) creates/oversees agencies; agency
  owners self-serve their branding, customers, and revenue. `agencies` are keyed
  by `owner_user_id` (UNIQUE → one agency per account); `agency_customers` link
  customer accounts to an agency (UNIQUE `customer_user_id` → one agency per
  customer) with the `monthly_price` the agency charges.
- **Routes.** Public `GET /branding` (whiteLabel mw, **before** auth). Then
  `auth + lockout`: `GET/PUT /settings`, `POST/GET /customers`, `GET /revenue`
  (owner self-service, scoped via `getOwnedAgency(req.user.userId)`, 404 if not
  an owner). Admin-only (adds `admin` mw): `POST /` (create), `GET /all`
  (overview with per-agency customer counts + monthly revenue + JS-computed
  totals).
- **createAgency assigns ownership.** Admin-only; optional `ownerEmail` assigns
  the agency to an existing user (defaults to the authenticated admin). This is
  what makes the multi-agency admin overview + per-owner portal coherent given
  `owner_user_id` is UNIQUE. Unique violations (`23505`) → **409** (owner already
  has an agency, or domain taken).
- **Dynamic theming.** `config/whiteLabel.js` `DEFAULT_BRANDING` mirrors the
  client `lib/branding.js` defaults (amber `#f59e0b` / gray-900 `#111827`). The
  `middleware/whiteLabel.js` resolves the request host (`X-White-Label-Domain` →
  `X-Forwarded-Host` → `Host`) to an active agency's branding and attaches
  `req.agencyBranding`; it **never throws** (branding is optional). The client
  `BrandingProvider` (wraps `main.jsx`) fetches `GET /branding` once, applies CSS
  vars + `document.title`, and feeds Sidebar/Login (logo/name + primaryColor
  inline styles). Colors are strict hex; logos must be http(s) URLs; custom
  domains are bare hostnames stored lower-cased.
- **Agency-owner detection (client).** `App.jsx` calls `getAgencySettings` after
  login; a 404 simply means "not an owner" (no Agency Portal nav). Admin White
  Label panel: `client/src/admin/AdminWhiteLabel.jsx`; owner portal:
  `client/src/sections/AgencyPortal.jsx` (customers + revenue + branding form
  with live preview). Migration `models/025_white_label.sql`.

### Affiliate program subsystem (`/api/affiliates`)

- **Anyone can join.** Not brand-scoped — keyed by `user_id` (UNIQUE → one
  affiliate record per account). Affiliates earn 20% (`COMMISSION_RATE`) of a
  referred user's **first month's payment** only.
- **Attribution chain.** Landing page reads `?ref=CODE` → stores in client
  `localStorage` (`lib/referral.js`) AND calls public `POST /track/:code` which
  sets an httpOnly cookie (`utils/referralTracking.js`, no cookie-parser — manual
  header parse). `authController.register` accepts `referralCode` in the body
  (falls back to the cookie) and **awaits** `attributeSignup` after COMMIT so the
  pending `referrals` row exists before the JWT is returned (closes the
  race where a fast first-payment webhook would otherwise miss the row). Attribution
  is best-effort (try/catch — a bad code never fails signup), guards self-referral
  and inactive affiliates, and dedups via UNIQUE `referred_user_id` + `ON CONFLICT
  DO NOTHING`.
- **Conversion is first-payment-only + idempotent.** `convertReferral(userId,
  amountCents)` is called (try/catch, never fails the webhook) from the Stripe
  `invoice.payment_succeeded` case when `amount_paid > 0`. It locks the pending
  zero-commission row `FOR UPDATE` in a tx and fills `commission_amount =
  round(cents * 0.2)/100`; renewals and duplicate webhooks are no-ops (only
  `status='pending' AND commission_amount=0` matches). It is NOT an HTTP route.
- **Routes.** Public `POST /track/:code` (before auth). Then `auth + lockout`:
  `POST /register` (409 dup, retry on code 23505), `GET /profile` (404 = "not an
  affiliate"), `GET /commissions`, `POST /payout` (records PayPal email + confirms
  approved balance; **no real money moves** — owner reconciles manually). Admin
  (`admin` mw): `GET /all`, `POST /approve` (action `approve`: pending→approved /
  `pay`: approved→paid, bumps `total_paid`), `POST /suspend` (status
  active|suspended).
- **Lifecycle.** Commission `status`: pending → approved → paid, advanced by the
  platform owner. Suspended affiliates earn nothing on new signups.
- Migration `models/026_affiliate_program.sql` (`affiliates` + `referrals`,
  NUMERIC money, set_updated_at triggers). Dashboard section
  `client/src/sections/AffiliateProgram.jsx` (Dashboard/Commissions/Payouts tabs,
  visible to all users); admin `client/src/admin/AdminAffiliates.jsx`
  (Affiliates tab in AdminPanel).

### Mobile API subsystem (`/api/v2`) + `EchoAI-Mobile/`

- **Native-app backend.** A versioned, mobile-optimized API for the iOS/Android
  app, additive and independent of the web `/api/*` routes. Three mounts (before
  the SPA fallback): `/api/v2/auth`, `/api/v2/push`, `/api/v2` (data).
- **Standard envelope.** Every v2 response is `{status,data,message,pagination}`
  via `utils/mobileResponse.js` (`success`/`fail`); `pagination` is null except on
  list endpoints. Same util holds the cursor `encode`/`decode`/`paginate` helpers.
- **Auth model (`mobileAuthController.js`).** Login/register issue a **30-day**
  access JWT (same `{userId,email}` shape + `JWT_SECRET` as web, so v2 tokens also
  authorize legacy `/api/*`) **plus** an opaque refresh token (only its SHA-256
  hash stored in `refresh_tokens`). Refresh is **single-use rotation** under
  `SELECT ... FOR UPDATE` (delete+reissue in one tx). Biometric = short-lived (5m)
  JWT with a `biometric:true` claim, minted while logged in and exchanged via
  `/auth/biometric/login`. Logout revokes one device (body `refreshToken`) or all.
- **Lockout invariant holds.** `/api/v2` **data** routes enforce `auth + lockout`
  (locked/past-due → 403), same as web data routes. The intended bypass exceptions
  are `/api/v2/auth/*` (recovery) and `/api/v2/push/*` (push management) — do not
  add lockout there. **Regression watch:** never mount v2 data routes with `auth`
  alone.
- **Ownership + no-mock conventions carry over.** Dashboard/leads scope via
  `getOwnedBrand` (404 on foreign brand); leads use keyset pagination
  (`ORDER BY created_at DESC, lead_id DESC`, `(created_at,lead_id) < cursor`,
  `limit+1` probe) for stable, no-skip/no-dupe paging.
- **FCM push.** `config/fcm.js` (legacy HTTP) + `controllers/mobilePushController.js`:
  device-token upsert into `device_tokens`, `sendToUser` fans out and prunes tokens
  FCM reports invalid. **Degrades gracefully** — when `FCM_SERVER_KEY` is unset,
  registration still succeeds (`pushConfigured:false`) and sends no-op. `sendToUser`
  is **best-effort/never-throws** and every caller invokes it with `.catch(...)`
  (and without `await` in request paths) so push never blocks/fails the request.
  Wired at: hot-lead (chatbot/websiteChatbot/phone controllers), weekly report
  (`scheduler.js`), payment failed (`subscriptionController.js`).
- Migration `models/027_mobile_tokens.sql` (`refresh_tokens`+`device_tokens`).
  Full endpoint/flow docs in `EchoAI/MOBILE_API.md`.
- **`EchoAI-Mobile/` is a source-only Expo (React Native) scaffold** — NOT a
  Replit artifact, so it does not run in the preview pane. React Navigation +
  AsyncStorage; auth (login/biometric/register), Home (dashboard), Leads (cursor
  pagination), Notifications, Settings. API client (`src/api/client.js`) parses
  the envelope and does refresh-on-401. Set the backend URL via
  `EXPO_PUBLIC_API_URL` or `app.json` → `extra.apiUrl`.

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
