# DEPLOYMENT_AND_RECOVERY.md

> **Method.** Verified against `EchoAI/railway.toml`, `EchoAI/nixpacks.toml`,
> `EchoAI/package.json`, `EchoAI/utils/runMigrations.js`, `EchoAI/config/db.js`,
> `EchoAI/config/environment.js`, `EchoAI/STAGING_ENV.md`, and
> `DEPLOYMENT_RAILWAY.md` (repo root). Where two config files disagree it is
> called out. **No platform code was modified.** Generated 2026-07-24.

---

## 1. How the platform is deployed (overview)

Zorecho deploys to **Railway** as a **single service** that serves both the
REST API (`/api/*`) and the prebuilt React SPA (`client/dist`) on one origin.
The build uses the **nixpacks** builder; dependencies are installed with
**Yarn** (npm's bundled version crashed on Railway — see §"Known deployment
gotchas"). The React SPA is **built locally and committed** to
`EchoAI/client/dist`; Railway does **not** build the client.

There are **two Railway services in one Railway project**:

| Environment | Domain | Railway service | Git branch | DB |
|---|---|---|---|---|
| **Production** | `https://app.zorecho.com` | `EchoAI-Foundation` | `main` | Production Postgres |
| **Staging** | `https://staging.zorecho.com` | `prolific-perception` | `staging` | Separate staging Postgres |
| Development | Replit workspace / `REPLIT_DEV_DOMAIN` | (Replit) | (working tree) | Dev Postgres (`DATABASE_URL`) |
| Public marketing | `https://zorecho.com` | Separate site (built later) | — | — |

*(Service names, domains, and branch mapping per the session global rules and
`EchoAI/STAGING_ENV.md`.)*

---

## 2. Current deployment configuration

### `EchoAI/railway.toml` (authoritative when the service Root Directory = `EchoAI`)
```toml
[build]
builder = "nixpacks"          # phases defined in nixpacks.toml

[deploy]
startCommand = "npm run migrate && node server.js"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### `EchoAI/nixpacks.toml`
- **setup:** `nodejs_20`, `python3`, `gcc`, `gnumake`, `yarn`.
- **install:** `rm -rf node_modules` → `yarn install --production=false --non-interactive --network-concurrency 1 --ignore-engines --frozen-lockfile` → a `node -e` step that `require.resolve()`s **every** production dependency and **fails the build loudly** if any is missing (guards against half-installs).
- **build:** verifies `client/dist/index.html` exists (`test -f ... || exit 1`). It does **NOT** build the client on Railway.

> ⚠️ **Discrepancy to flag for the reviewer.** The repo-root `DEPLOYMENT_RAILWAY.md`
> documents a *different* config:
> `buildCommand = "cd EchoAI && npm install && cd client && npm install && npm run build"`
> and `startCommand = "cd EchoAI && npm run migrate && node server.js"`.
> That reflects an **older/alternate** setup where the Railway Root Directory is
> the repo root and npm builds the client. The **current** `EchoAI/*.toml` uses
> nixpacks + yarn + prebuilt `client/dist`. **Which one Railway actually reads
> depends on the service's Root Directory setting**, which cannot be confirmed
> from the code alone → **UNVERIFIED** which is live. Both a root `railway.toml`
> and an `EchoAI/railway.toml` exist. A reviewer should confirm the Railway
> service Root Directory in the Railway dashboard.

### `NIXPACKS_INSTALL_CMD` note
`DEPLOYMENT_RAILWAY.md` suggests setting `NIXPACKS_INSTALL_CMD=true` (a no-op)
if the monorepo's root pnpm install interferes. Relevant only in the
root-directory deploy mode.

---

## 3. Build & start commands

| Purpose | Command | Where |
|---|---|---|
| Start server (local/prod runtime) | `node server.js` (`npm start`) | `package.json` |
| Dev with reload | `node --watch server.js` (`npm run dev`) | `package.json` |
| **Run migrations** | `node utils/runMigrations.js` (`npm run migrate`) | `package.json` |
| Seed first admin | `npm run seed` (calls `utils/adminSeeder.seedAdmin`) | `package.json` |
| Build client SPA | `cd client && npm install && npm run build` (`npm run build:client`) | `package.json` — **run locally, commit `client/dist`** |
| Full prod bootstrap | `npm run start:prod` = `migrate && build:client && node server.js` | `package.json` — used per `STAGING_ENV.md` staging start command |
| **Railway deploy start** | `npm run migrate && node server.js` | `EchoAI/railway.toml` (client NOT built here) |

> Note the mismatch: `STAGING_ENV.md` §1 lists the staging **Start command** as
> `npm run start:prod` (which *does* build the client), while
> `EchoAI/railway.toml` `startCommand` is `npm run migrate && node server.js`
> (which does not). **UNVERIFIED** which is set on each Railway service.

---

## 4. Environment requirements

**Critical (boot aborts if missing — `config/env.js`):** `DATABASE_URL`,
`JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`.
**Environment identity:** `APP_ENV` (`production`/`staging`/`development`) —
wins over all detection; on staging it must be `staging`.
**Do NOT set `PORT`** — Railway injects it; `server.js` reads `process.env.PORT`
(default 5000).
Full annotated list of every variable → `ENVIRONMENT_AND_INTEGRATIONS.md` and
`env.example`. Staging variable policy (test keys, AI caps, redirect URIs) →
`EchoAI/STAGING_ENV.md` §2.

---

## 5. Database migration procedure

- Runner: **`EchoAI/utils/runMigrations.js`** (`npm run migrate`).
- Applies `models/schema.sql` **first**, then all numbered `models/*.sql` in
  filename sort order.
- Tracks applied files in a **`schema_migrations`** table → **idempotent**;
  re-running skips already-applied files. Safe to run on every deploy.
- Each migration runs in its **own transaction**; a genuine failure **rolls
  back and aborts the whole run** (does not mark the file applied) — prevents
  silent schema drift.
- **Connection retry:** `connectWithRetry` retries up to **30×** at 2s
  intervals (~60s) so a cold Railway container that starts before the DB's
  private network is reachable does not crash the deploy.
- Migrations run at **deploy/start time**, not build time, because the DB is
  only reachable at deploy.
- House rule (per `STAGING_ENV.md` §5): **migrations are additive-only**; any
  destructive migration requires its own CEO-approved plan.

To run manually against Railway:
`railway run --service <name> bash -c "cd EchoAI && npm run migrate"`.

> ⚠️ **Duplicate migration numeric prefixes exist** (e.g. two `054_`, `067_`,
> `068_`, `090_`, `096_`). They still apply because ordering is by full
> filename and each is tracked individually, but the duplicated numbers are a
> maintenance smell — detailed in `DATABASE_MAP.md`.

---

## 6. Rollback procedure (per `STAGING_ENV.md` §5)
- **Code rollback:** Railway → service → **Deployments → previous deployment →
  Redeploy** (~2 min; both services keep history).
- **Schema rollback:** none by design — migrations are additive-only, so old
  code safely ignores new columns/tables. No down-migrations exist.

---

## 7. Backup & restore procedure
- **Backups:** Managed by **Railway's Postgres** (Railway's built-in
  backups/snapshots). **No application-level backup job was found in the
  verified code** → **UNVERIFIED** beyond Railway's platform backups.
- **Durable media:** AI-generated images and uploaded post/vision media are
  copied into the database (`stored_files`, `vision_reference_images`) and
  restored on read, because the Railway disk is **ephemeral** (wiped each
  deploy). See `server.js` L333–369, `utils/storedFiles.js`,
  `utils/visionFiles.js`. On boot the server best-effort backfills DB copies
  from any disk files that survive.
- **Restore:** Standard Postgres restore of the Railway instance. Application
  code auto-bootstraps a fresh DB via the migration runner (schema.sql first).
  `STAGING_ENV.md` §6 explicitly uses "delete & recreate the staging Postgres,
  redeploy, let the bootstrap rebuild it" as a quarterly verification of the
  restore path.

---

## 8. Branch structure & promotion
- **`main`** → production (`EchoAI-Foundation` / `app.zorecho.com`), auto-deploy on push.
- **`staging`** → staging (`prolific-perception` / `staging.zorecho.com`), auto-deploy on push.
- **development** → the Replit working tree (no dedicated long-lived branch verified).
- **Promotion workflow (`STAGING_ENV.md` §3):** milestone green in Replit →
  push to `staging` → Railway staging auto-deploys + migrates → ~10-min staging
  smoke pass → CEO approval → merge `staging`→`main` → production auto-deploys.
  **"Nothing reaches `main` that didn't run on staging first."**

---

## 9. Healthcheck & startup sequence
1. Railway runs `npm run migrate` (idempotent; retries DB connection).
2. `node server.js` boots: `validateEnv()` (aborts on missing critical vars) →
   mounts routers → `app.listen` → `startScheduler()` (registers ~35 cron jobs)
   → `seedAdmin()` → best-effort media backfills.
3. Railway polls **`GET /api/health`** (returns name/status/environment/version)
   until `200` before routing traffic. `healthcheckTimeout = 300s` allows a cold
   start that runs migrations first.
4. Restart policy: `on_failure`, max 3 retries.

Expected deploy-log order: `Connected to PostgreSQL database` → migration
`+ applied` / `= skip` lines → feature enabled/disabled summary → `Zorecho
server is running on port <PORT>` → `Schedulers started: N jobs registered`.

---

## 10. Known deployment failures / gotchas (from the config comments)
- **npm install crash on Railway** — Node 20's bundled npm hit `"Exit handler
  never called!"` / `ENOTEMPTY … rename node_modules/<pkg>`, leaving
  `node_modules` half-installed (e.g. missing `dotenv`) and crashing at runtime.
  **Fix in place:** install with **Yarn `--frozen-lockfile`** + a post-install
  `require.resolve()` verification of every dependency (fails the build if any
  package is missing). Documented at length in `nixpacks.toml`.
- **Do NOT `npm install` at deploy time** — installing on top of the baked
  image node_modules re-triggers the crash. Deps are installed only in the build
  phase (`railway.toml` comment).
- **Client build cannot run on Railway** — the client's npm install hit the same
  crash, so `client/dist` is prebuilt locally and committed; the build phase
  only verifies it exists. **Operational risk:** if a developer changes
  `client/src` but forgets to rebuild and commit `client/dist`, Railway ships
  the stale bundle (no error). Reminder is in `nixpacks.toml`.
- **Two `railway.toml` files** (root + `EchoAI/`) with different build commands →
  which is authoritative depends on the Railway Root Directory setting
  (**UNVERIFIED** from code; §2).
- **`index.html` caching** — served `no-cache` while hashed assets are
  `immutable`; a stale cached `index.html` would pin an old bundle, so it must
  always revalidate (`server.js` L394–404). Symptom of misconfig: blank/old page
  after deploy (hard-refresh fixes).
- **Ephemeral disk** — any media not mirrored to the DB is lost each deploy
  (§7).

---

## 11. Known production-specific differences vs. staging/dev
- **Background/paid AI is production-gated.** In non-production
  (`isProduction()` false) paid AI calls are blocked unless
  `DEVELOPMENT_AI_ENABLED=true`, and are capped by `AI_BUDGET_DEV_DAILY_USD`
  (staging recommended cap `$5`). See `config/environment.js`,
  `config/aiControls.js`, `AI_AND_INFRASTRUCTURE_COST_MAP.md`.
- **CORS is strict only in production** (`NODE_ENV=production` → allowlist
  enforced); non-prod allows all origins. Public chatbot-widget endpoints are
  open to any origin in all environments (`server.js`).
- **noindex** — every non-production response carries
  `X-Robots-Tag: noindex, nofollow`; production is indexable.
- **Stripe** — staging uses **test-mode** keys/prices + a test webhook; prod
  uses live keys.
- **`FREE_TEST_MODE=true`** on staging (all accounts treated as beta).
- **Cookies** — session cookie `secure` only when `NODE_ENV=production`.
- **Google OAuth** verified working end-to-end on **staging 2026-07-23** (CEO);
  **Facebook staging connect not yet tested** (per global rules).

---

## 12. Deploy-related files (quick reference)
| File | Role |
|---|---|
| `EchoAI/railway.toml` | Nixpacks build + `migrate && node server.js` start + healthcheck (Root Directory = `EchoAI`). |
| `EchoAI/nixpacks.toml` | Yarn install + dep verification + prebuilt-dist check. |
| root `railway.toml`, root `nixpacks.toml` | Alternate/legacy config for repo-root Root Directory (**UNVERIFIED** which is live). |
| `EchoAI/package.json` | `migrate`, `seed`, `build:client`, `start:prod`, `start` scripts. |
| `EchoAI/utils/runMigrations.js` | Idempotent migration runner (`schema_migrations`). |
| `EchoAI/config/db.js` | `pg` Pool from `DATABASE_URL`. |
| `EchoAI/config/environment.js` | Environment detection (money-gating). |
| `EchoAI/STAGING_ENV.md` | Staging runbook, env policy, promotion, rollback, data policy. |
| `DEPLOYMENT_RAILWAY.md` (root) | Step-by-step Railway guide (reflects the alternate root-dir config). |
| `DEPLOYMENT.md` (root) | General deployment doc (reference). |
