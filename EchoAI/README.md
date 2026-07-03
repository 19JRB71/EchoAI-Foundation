# EchoAI

EchoAI is an AI-powered SaaS marketing platform. It automates Facebook ad
campaigns, qualifies leads with an AI chatbot, discovers brand voice, generates
multi-platform social/video/email content, produces AI images, and reports
weekly analytics with automatic optimization — all behind a Stripe-billed
subscription.

The backend is a single Node.js/Express (CommonJS) server that serves both the
JSON API (`/api/*`) and the built React SPA on one origin.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Environment variables](#environment-variables)
- [Database & migrations](#database--migrations)
- [Running in development](#running-in-development)
- [Running in production](#running-in-production)
- [Connecting third-party services](#connecting-third-party-services)
- [API reference](#api-reference)
- [Production hardening](#production-hardening)

---

## Features

| Feature | Description |
| --- | --- |
| **Auth & accounts** | JWT-based signup/login, bcrypt password hashing, role-based access (user/admin). |
| **Subscriptions & billing** | Stripe-backed plans (starter/growth/pro/enterprise), upgrades/downgrades with proration, payment-method updates, invoices, webhooks, and a payment-failed lockout/recovery flow. |
| **Brand discovery** | AI (Anthropic) interview that derives brand voice, audience, and taglines. |
| **Facebook ad automation** | OAuth connection to a Facebook ad account, AI ad-creative generation, and campaign creation. |
| **Lead qualification chatbot** | Public chatbot that scores leads hot/warm/cold and alerts the owner by email + web push on hot leads. |
| **Social media** | AI content generation + scheduled multi-platform posting (facebook/instagram/tiktok/linkedin/twitter/youtube). |
| **Video content** | AI video-package generator (hook, scenes, CTA, music, thumbnail) per platform/length. |
| **Email marketing** | AI email-sequence generator + transactional sending with idempotent, transactional step advancement. |
| **Image studio** | DALL·E image generation, persisted to disk, with an ad-set generator and a library. |
| **Analytics & optimization** | Weekly analytics recording, AI weekly reports by email, and automatic campaign optimization. |
| **Web push (PWA)** | Installable PWA with VAPID web-push notifications for hot-lead alerts. |

---

## Tech stack

- **Runtime:** Node.js, Express 5 (CommonJS)
- **Database:** PostgreSQL (`pg`) + raw SQL migrations
- **Auth:** `jsonwebtoken`, `bcrypt`
- **Sessions:** `express-session` + `connect-pg-simple` (OAuth CSRF state)
- **AI:** `@anthropic-ai/sdk` (text), `openai` (voice + images)
- **Payments:** `stripe`
- **Email:** `nodemailer` (SMTP)
- **Push:** `web-push` (VAPID)
- **Scheduling:** `node-cron`
- **Security/ops:** `cors`, `express-rate-limit`, `morgan`
- **Client:** React + Vite SPA (in `client/`)

---

## Project structure

```
EchoAI/
├── server.js            # Express app: middleware, routes, SPA serving, error handling
├── config/              # db, env validation, anthropic, openai, stripe, webpush, plans, facebook
├── controllers/         # Route handlers (business logic)
├── routes/              # Express routers, mounted under /api/*
├── middleware/          # auth (JWT), admin, lockout
├── prompts/             # AI prompt builders
├── utils/               # scheduler, adminSeeder, runMigrations, email, encryption, socialApi
├── models/              # Numbered SQL migrations (002…017) + schema.sql
└── client/              # React + Vite SPA (built to client/dist)
```

---

## Environment variables

### Required (server will not boot without these)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `JWT_SECRET` | Secret used to sign/verify auth tokens. |
| `SESSION_SECRET` | Secret for OAuth CSRF session cookies. |
| `ENCRYPTION_KEY` | AES-256 key for encrypting stored third-party tokens. |

### Admin seeder

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAIL` | Email of the admin account created on first boot. |
| `ADMIN_PASSWORD` | Password for that admin account. |

### Feature integrations (each gates one feature; missing → feature disabled, not a crash)

| Variable | Feature |
| --- | --- |
| `ANTHROPIC_API_KEY` | AI text (brand discovery, content, reports). |
| `ANTHROPIC_MODEL` | (Optional) override the Anthropic model id. |
| `OPENAI_API_KEY` | Voice (STT/TTS) and image generation. |
| `STRIPE_SECRET_KEY` | Billing. |
| `STRIPE_PUBLISHABLE_KEY` | Stripe.js on the client. |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures. |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_PRO` / `_ENTERPRISE` | Stripe Price IDs per tier. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | Outbound email. |
| `EMAIL_FROM` | From address for transactional email. |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook ad-account OAuth. |
| `FACEBOOK_REDIRECT_URI` | (Optional) override the OAuth callback URL. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push. |

### Operational (optional)

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (default 5000; the platform sets this). |
| `NODE_ENV` | Set to `production` to enable strict CORS + secure cookies. |
| `ALLOWED_ORIGINS` | Comma-separated extra origins allowed by CORS in production. |
| `RATE_LIMIT_MAX` | Max API requests per IP per 15 min (default 1000). |

> Secrets are managed through the Replit Secrets tab — never commit them.

---

## Database & migrations

Migrations are numbered SQL files in `models/`, applied in filename order. They
are written with `IF NOT EXISTS` so re-runs are safe.

```bash
npm run migrate     # apply all pending migrations (idempotent)
```

The runner records applied files in a `schema_migrations` table and skips
already-applied ones. Against a database migrated before this runner existed, it
baselines automatically (treats "already exists" as applied).

---

## Running in development

```bash
# 1. Install backend deps
npm install

# 2. Apply migrations
npm run migrate

# 3. Build the client (served by the API server)
npm run build:client

# 4. Start the API server (serves API + SPA on $PORT, default 5000)
npm run dev          # auto-reload, or: npm start
```

> On Replit this runs via the `artifacts/api-server: EchoAI` workflow. After
> editing anything in `client/`, rebuild (`npm run build:client`) and restart the
> workflow — the server serves the pre-built `client/dist` (no dev HMR).

---

## Testing

```bash
npm test    # node --test over test/**/*.test.js and tests/**/*.test.js
```

The suite covers the AI Setup Agent end-to-end (`test/setupAgent.e2e.test.js`)
plus the setup-agent health/gating/lease unit tests (`tests/*.test.js`). It runs
against a **real Postgres database** and the **real Express routes/controllers** —
only the Anthropic client is stubbed (deterministic, offline, no API spend), so no
real AI calls are made.

### Test-database isolation (never touches real customer data)

These tests create and then **DELETE** real `users`, `brands`, `subscriptions`,
etc. rows, so they must **never** run against the app's real database. Isolation is
guaranteed by construction — the suite always runs against a **physically separate
Postgres database** (a distinct database namespace shares no tables), never the one
`DATABASE_URL` points at:

- **Setup (`npm run pretest`, `tests/setupTestDb.js`).** Chooses the isolated test
  database, creates it if needed, and applies `models/schema.sql` + all numbered
  migrations to it. The app's real database is used only as a maintenance
  connection to issue `CREATE DATABASE` — no app tables are read or written there.
- **Guard (`tests/dbGuard.js`).** Preloaded via `node --require` (and also required
  by `tests/helpers.js` + the e2e test) so that **before any pool is opened** it
  rewrites `DATABASE_URL` to the isolated test database. Everything downstream
  (`config/db.js`, controllers, the migration runner) binds to the test DB.

How the isolated database is chosen (`tests/resolveTestDb.js`):

- If **`TEST_DATABASE_URL`** is set, it is used — but only after verifying it is a
  *different* physical database than `DATABASE_URL` (else the run aborts).
- Otherwise one is **auto-derived** on the same server by suffixing the database
  name with `_setup_test` (e.g. `echoai` → `echoai_setup_test`).
- Either way the run **fails fast** (non-zero exit, clear message, no mutation) if
  it looks like production: `NODE_ENV=production`, `REPLIT_DEPLOYMENT` set, the URL
  equals `PROD_DATABASE_URL`/`PRODUCTION_DATABASE_URL`, or the host/database name
  contains `prod`. There is **no fallback that runs against the real database.**

**Runner requirements** (the same env the app boots with):

- `DATABASE_URL` — a reachable Postgres server. It is **never used as the test
  database**; the suite derives/uses a separate database on it (and needs
  create-database rights unless `TEST_DATABASE_URL` points at a pre-provisioned
  test DB). Schema is applied automatically to the test DB — no manual
  `npm run migrate` needed for tests.
- `TEST_DATABASE_URL` *(optional)* — point at a pre-provisioned, dedicated test
  database to use instead of the auto-derived one. Must be a different physical
  database than `DATABASE_URL`.
- `JWT_SECRET` — used to mint test auth tokens.
- `SESSION_SECRET`, `ENCRYPTION_KEY` — required at module load (boot fails fast
  without them, so the tests can't `require` the app either).
- `ANTHROPIC_API_KEY` — **read at import time but never called** (the Anthropic
  singleton's `messages.create` is replaced with a stub). Any non-empty value
  works; no live key or spend is needed.

On Replit this suite is registered as the **`test` validation step** (`cd EchoAI
&& npm test`), so a broken onboarding flow fails validation and blocks task
completion instead of slipping through silently.

---

## Running in production

A single command runs migrations, builds the client, and starts the server:

```bash
npm run start:prod
```

This is equivalent to:

```bash
npm run migrate        # apply DB migrations in order
npm run build:client   # build the React SPA to client/dist
node server.js         # start the server (serves API + SPA)
```

The admin account is seeded automatically on boot from `ADMIN_EMAIL` /
`ADMIN_PASSWORD`. Set `NODE_ENV=production` to enable strict CORS and secure
cookies.

---

## Connecting third-party services

### Anthropic (AI text)
1. Create a key at <https://console.anthropic.com>.
2. Set `ANTHROPIC_API_KEY`. Optionally pin `ANTHROPIC_MODEL`.

### OpenAI (voice + images)
1. Create a key at <https://platform.openai.com/api-keys> with billing enabled.
2. Set `OPENAI_API_KEY`.

### Stripe (billing)
1. Get your secret/publishable keys from the Stripe dashboard.
2. Create a recurring Price for each tier and set `STRIPE_PRICE_*`.
3. Add a webhook endpoint pointing to `/api/subscriptions/webhook` and set
   `STRIPE_WEBHOOK_SECRET`.
4. Set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`.

### Facebook (ad-account OAuth)
1. Create an app at <https://developers.facebook.com> (Business type) and add the
   **Facebook Login** product.
2. Copy **App ID** / **App Secret** → `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`.
3. In Facebook Login → Settings, add the Valid OAuth Redirect URI:
   `https://<your-domain>/api/facebook/oauth/callback`.

### SMTP (email)
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, and
`EMAIL_FROM` for your provider (e.g. SendGrid, Mailgun, SES).

### Web push (VAPID)
Generate a keypair once with `npx web-push generate-vapid-keys` and set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` URL).
**Do not regenerate** — it invalidates all existing subscriptions.

---

## API reference

All routes are prefixed with `/api`. Unless noted, protected routes require an
`Authorization: Bearer <jwt>` header. Errors always return JSON
(`{ "error": "..." }`).

| Group | Base path | Notable routes |
| --- | --- | --- |
| Health | `/api/health` | `GET /` |
| Auth | `/api/auth` | `POST /signup`, `POST /login`, `GET /me` |
| Subscriptions | `/api/subscriptions` | `POST /`, `POST /cancel`, `GET /status`, `GET /plans`, `POST /change`, `GET|POST /payment-method`, `GET /invoices`, `GET /upcoming-invoice`, `POST /webhook` |
| Brands | `/api/brands` | CRUD + brand discovery |
| Campaigns | `/api/campaigns` | Ad creative + campaign management |
| Leads | `/api/leads` | Lead CRUD; chatbot scoring |
| Analytics | `/api/analytics` | Weekly analytics + reports |
| Optimize | `/api/optimize` | Campaign auto-optimization |
| Social | `/api/social` | `POST /connect`, `POST /generate`, `POST /schedule`, `GET /calendar/:brandId`, `GET /accounts/:brandId`, `GET /performance/:brandId` |
| Video | `/api/video` | `POST /generate`, `POST /scripts`, `GET /scripts/:brandId`, `DELETE /scripts/:scriptId` |
| Email campaigns | `/api/email-campaigns` | `POST /generate`, `POST /`, `POST /:id/send`, `GET /:brandId`, `GET /performance/:brandId` |
| Images | `/api/images` | `POST /generate`, `POST /ad-set`, `POST /`, `GET /:brandId`, `DELETE /:imageId` |
| Push | `/api/push` | `GET /vapid-public-key`, `POST /subscribe` |
| Facebook | `/api/facebook` | `POST /oauth/initiate`, `GET /oauth/callback`, `GET /accounts`, `POST /select-account`, `POST /disconnect` |
| Admin | `/api/admin` | Admin-only user/platform management |
| Voice | `/api/voice` | STT/TTS |

---

## Production hardening

The server applies the following in all environments (strict mode in production):

- **Request logging** — every request is logged via `morgan` (`combined` in
  production).
- **CORS** — in production, API access is restricted to `REPLIT_DOMAINS` plus any
  `ALLOWED_ORIGINS`; permissive in development for the preview iframe.
- **Rate limiting** — `express-rate-limit` caps requests per IP (default 1000 per
  15 min, `RATE_LIMIT_MAX`); the Stripe webhook is exempt.
- **Env validation** — boot aborts with a clear message if a required variable is
  missing; optional features degrade gracefully (return 503 / "not configured").
- **JSON everywhere** — unknown `/api` routes return JSON 404, malformed request
  bodies return JSON 400, and a global error handler guarantees no HTML
  stack-trace pages or crashes.
- **Secure sessions** — `httpOnly`, `sameSite=lax`, `secure` in production;
  Postgres-backed session store.
