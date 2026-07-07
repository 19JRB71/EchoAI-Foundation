# Deploying EchoAI to Railway

This guide walks you through deploying EchoAI to [Railway](https://railway.app)
from zero to a live, custom-domain production app.

EchoAI is a **standalone Node/Express app** in the `EchoAI/` subdirectory of this
repository, with a React (Vite) client in `EchoAI/client/`. In production the
Express server serves **both** the REST API (`/api/*`) and the built React SPA on
a single origin/port — you deploy **one** service.

The repository already contains everything Railway needs:

- `railway.toml` (repo root) — build & start commands, healthcheck, restart policy.
- `EchoAI/.env.example` — every environment variable, documented.
- `EchoAI/client/.env.example` — the client build-time (Vite) variables.

---

## What `railway.toml` does

```toml
[build]
buildCommand = "cd EchoAI && npm install && cd client && npm install && npm run build"

[deploy]
startCommand = "cd EchoAI && npm run migrate && node server.js"
healthcheckPath = "/api/health"
```

- **Build:** installs server dependencies, installs client dependencies, and
  builds the React SPA into `EchoAI/client/dist`.
- **Start:** runs all pending database migrations (idempotent — safe on every
  deploy), then starts the server. `server.js` reads `PORT` (Railway injects it)
  and serves the API + SPA together.
- **Healthcheck:** Railway waits for `GET /api/health` to return `200` before
  sending traffic to a new deploy.

> Migrations run at **start**, not build, because the database is only reachable
> at deploy time. The runner records applied files in a `schema_migrations` table,
> so re-running does nothing once everything is applied.

---

## Step 1 — Create a Railway account

1. Go to <https://railway.app> and click **Login**.
2. Sign in with GitHub (recommended — it lets you deploy directly from your repo)
   or with email.
3. New accounts start on the trial plan. To run a long-lived production app you
   will want the **Hobby** (or higher) plan — open **Account → Plans** and upgrade
   so the service does not sleep and you get a persistent database.

---

## Step 2 — Get the code onto Railway

You have two options. **Option A (GitHub) is strongly recommended** — it gives you
automatic redeploys on every push.

### Option A — Deploy from a GitHub repo

1. Push this repository to GitHub if it is not already there.
2. In Railway, click **New Project → Deploy from GitHub repo**.
3. Authorize Railway to access your GitHub account and pick the repository.
4. Railway creates a service and reads `railway.toml` from the repo root
   automatically. Leave the service **Root Directory** as `/` (the repo root) —
   `railway.toml` handles changing into `EchoAI/`.

### Option B — Deploy with the Railway CLI (upload without GitHub)

1. Install the CLI: `npm i -g @railway/cli`
2. `railway login`
3. From the repository root: `railway init` (creates a new project), then
   `railway up` to upload and build the current directory.

---

## Step 3 — Add a PostgreSQL database

1. In your Railway **project**, click **New → Database → Add PostgreSQL**.
2. Railway provisions Postgres and automatically exposes a `DATABASE_URL`
   variable to services in the project.
3. Attach it to your app service: open the **app service → Variables → New
   Variable → Add Reference → `DATABASE_URL`** (from the Postgres service). This
   makes Railway's managed `DATABASE_URL` available to EchoAI. The app reads
   `process.env.DATABASE_URL` directly (see `EchoAI/config/db.js`), so no code
   changes are needed.

---

## Step 4 — Set environment variables

Open your **app service → Variables** and add the variables below. The full,
commented list lives in `EchoAI/.env.example`; this is the deployment-critical
subset.

### Required — the app will not boot without these

| Variable | What it is | How to generate |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Added automatically in Step 3 |
| `JWT_SECRET` | Auth-token signing secret | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SESSION_SECRET` | OAuth CSRF session secret | same command as above |
| `ENCRYPTION_KEY` | AES-256 key (exactly 64 hex chars) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### Strongly recommended for production

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (enables strict CORS + correct cache headers) |
| `ALLOWED_ORIGINS` | Your custom domain(s), comma-separated, e.g. `https://app.yourdomain.com` |
| `PUBLIC_BASE_URL` | Public URL of the server, e.g. `https://app.yourdomain.com` |
| `APP_URL` | Same as above (used for links inside outbound emails) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The first admin account created on startup |

> **Do not set `PORT`.** Railway injects it and the server already reads it.

### Client build-time variables (Vite)

These are **baked into the React bundle during the build step**, so they must be
present as service variables *before* the build runs:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | Leave **empty** — the SPA and API share one origin |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key (`pk_live_...`) for the billing UI |

### Optional feature variables

Each of these unlocks a feature; when unset, that feature degrades gracefully
(returns "not configured" / 503) instead of breaking the app. See
`EchoAI/.env.example` for the complete annotated list:

- **AI:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- **Voice:** `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- **Billing:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`, `STRIPE_PRICE_SEAT`
- **Email (SMTP):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- **Facebook:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI`
- **Google:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- **Web push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (keep stable after launch)
- **Mobile push:** `FCM_SERVER_KEY`
- **AI Sales Agent:** `SALES_TWILIO_ACCOUNT_SID`, `SALES_TWILIO_AUTH_TOKEN`, `SALES_TWILIO_NUMBER`
- **Music search:** `YOUTUBE_API_KEY`

> **OAuth redirect URIs:** after you know your final domain, set
> `FACEBOOK_REDIRECT_URI` and `GOOGLE_REDIRECT_URI` to
> `https://<your-domain>/api/facebook/oauth/callback` and
> `https://<your-domain>/api/google/oauth/callback`, and register those exact URLs
> in the Facebook and Google developer consoles.

---

## Step 5 — Run database migrations

Migrations run **automatically on every deploy** via the start command
(`npm run migrate && node server.js`), applied **in numeric order** from
`EchoAI/models/*.sql`. You normally do not need to do anything.

To run them manually (e.g. to verify, or from your machine against the Railway
database):

```bash
# Using the Railway CLI, from the repo root:
railway run --service <your-service-name> bash -c "cd EchoAI && npm run migrate"
```

Or open the service's **Deploy Logs** after a deploy — you will see each
migration file being applied.

To create the first admin user (if you did not set `ADMIN_EMAIL` /
`ADMIN_PASSWORD`, or want to reseed):

```bash
railway run --service <your-service-name> bash -c "cd EchoAI && npm run seed"
```

---

## Step 6 — Connect a custom domain

1. In your **app service → Settings → Networking → Custom Domain**, click
   **Add Custom Domain** and enter your domain (e.g. `app.yourdomain.com`).
2. Railway shows a **CNAME** target. Add that CNAME record at your DNS provider
   (e.g. `app` → `xxxx.up.railway.app`). For an apex/root domain, use your DNS
   provider's ALIAS/ANAME feature or a `www` subdomain.
3. Wait for DNS to propagate. Railway provisions a TLS certificate automatically
   (HTTPS works with no extra steps).
4. **Update CORS + URLs to match the domain**, then redeploy:
   - `ALLOWED_ORIGINS=https://app.yourdomain.com`
   - `PUBLIC_BASE_URL=https://app.yourdomain.com`
   - `APP_URL=https://app.yourdomain.com`
   - Update `FACEBOOK_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` and re-register them.

> **How CORS works here:** in production (`NODE_ENV=production`) the server only
> accepts browser requests from origins in `ALLOWED_ORIGINS` (plus any
> `REPLIT_DOMAINS`, which is empty on Railway). The public chatbot widget
> endpoints are intentionally open to any origin so they can be embedded on
> customer sites. See `EchoAI/server.js` for the exact policy.

---

## Step 7 — Verify the deployment

After the deploy finishes:

1. **Healthcheck:** visit `https://<your-domain>/api/health` — it should return a
   `200` JSON status. Railway also gates the deploy on this.
2. **Frontend loads:** visit `https://<your-domain>/` — the EchoAI dashboard/login
   should render (this confirms the SPA is being served from `client/dist`).
3. **Log in** with your `ADMIN_EMAIL` / `ADMIN_PASSWORD` and open the app.
4. **Admin → Diagnostics → Generate Full Diagnostic Report** — a quick end-to-end
   check that the API and database are wired up correctly.
5. **Check logs:** the service **Deploy Logs** should show, in order:
   `Connected to PostgreSQL database`, the migration runner output, a feature
   enabled/disabled summary, and `Server listening on <PORT>`.
6. **Stripe webhooks (if using billing):** create a webhook endpoint in the
   Stripe dashboard pointing at
   `https://<your-domain>/api/subscriptions/webhook`, then set
   `STRIPE_WEBHOOK_SECRET` and redeploy.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Deploy crashes immediately with "Missing required environment variable(s)" | One of `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY` is unset. |
| Page loads but API calls are blocked by CORS | `ALLOWED_ORIGINS` does not exactly match your domain (scheme + host), or `NODE_ENV` is not `production`. |
| Billing UI can't find Stripe key | `VITE_STRIPE_PUBLISHABLE_KEY` was not set **before** the build ran — set it and redeploy so it re-bakes into the bundle. |
| Blank page / old version after deploy | Hard-refresh once. `index.html` is served `no-cache`; hashed assets are immutable, so a fresh build always loads after a reload. |
| "client build not found" warning in logs | The build step failed or was skipped — check Build Logs; ensure `railway.toml` build command ran. |
| Build is slow or fails during the install phase | This repo is a monorepo with a pnpm workspace at the root, so Nixpacks may run its own `pnpm install` at the repo root before our build command. The `railway.toml` build command already installs everything EchoAI needs. If the root install phase is slow or errors, set the service variable `NIXPACKS_INSTALL_CMD=true` (a no-op) so Nixpacks skips its auto-install and relies solely on the build command. |
| OAuth (Facebook/Google) callback errors | Redirect URIs in the provider console must exactly match `https://<your-domain>/api/<provider>/oauth/callback`. |

---

## Summary of files for Railway

| File | Purpose |
|---|---|
| `railway.toml` | Build/start commands, healthcheck, restart policy |
| `EchoAI/.env.example` | Full annotated list of every environment variable |
| `EchoAI/client/.env.example` | Client build-time (Vite) variables |
| `DEPLOYMENT_RAILWAY.md` | This guide |
