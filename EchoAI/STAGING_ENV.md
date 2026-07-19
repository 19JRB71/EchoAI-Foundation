# STAGING_ENV.md — Staging Environment Checklist & Runbook

**Governing reference:** `ZORECHO_OPERATIONAL_ROADMAP.md`, Phase 4.
This is the single checklist for setting up, operating, and verifying the Railway
staging service. Same variable **names** as production, different **values**.

---

## 1. One-time Railway setup (CEO, in the Railway dashboard)

1. **Create the `staging` branch** in GitHub (from `main`). This can be done from
   the GitHub web UI: branch dropdown → type `staging` → "Create branch".
2. **New Railway service** in the same project:
   - Source: same GitHub repo, **branch `staging`** (auto-deploy on push).
   - Start command: `npm run start:prod` (identical to production).
   - Root directory: same as production (`EchoAI` if production uses it).
3. **New Railway Postgres instance** for staging. Never share the production
   database. Copy its connection string into the staging service's `DATABASE_URL`.
4. **Domain:** use the Railway-generated `*.up.railway.app` domain for staging.
   Do not attach the customer-facing domain.
5. Set the variables per the policy table below.
6. First deploy: push anything to `staging` (or click "Deploy"). The migration
   runner bootstraps the fresh DB (schema.sql first, then migrations).

## 2. Environment variable policy

| Variable | Staging policy |
|---|---|
| `APP_ENV` | **`staging`** — REQUIRED. This is what makes the service identify as staging (banner, noindex, AI cost policy). |
| `DATABASE_URL` | Staging Postgres instance. **Never** production's. |
| `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY` | Staging-unique random values. **Never** production's. |
| `NODE_ENV` | `production` (same build behavior; environment identity comes from `APP_ENV`). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Staging-unique admin credentials. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NOUS_PORTAL_API_KEY`, `ELEVENLABS_API_KEY` | Real keys (real behavior is the point) — protected by the caps below. |
| `DEVELOPMENT_AI_ENABLED` | `true` — staging is non-production, so paid AI is blocked without this explicit switch. |
| `AI_BUDGET_DEV_DAILY_USD` | Set the staging daily AI cap (recommended: `5`). This cap applies to ALL paid calls on staging because staging is a non-production environment. |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | **Test-mode** keys and price IDs. Add a staging webhook endpoint in the Stripe dashboard (test mode) pointing at `https://<staging-domain>/api/subscriptions/webhook`. |
| Twilio (`TWILIO_*`, `SALES_TWILIO_*`) | Dedicated staging number, or **unset** (features degrade to 503 by design). Never the production numbers. |
| `FACEBOOK_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | Same apps; **add the staging redirect URIs** in the FB/Google consoles. Connect only sandbox/test accounts, never a customer's. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Staging-unique pair (generate fresh; do not reuse production's). |
| SMTP (`SMTP_HOST` etc.) | Unset (emails 503 gracefully) or a test inbox — never a real customer-facing sender. |
| `FREE_TEST_MODE` | `true` — all staging accounts are "beta". |
| `ALLOWED_ORIGINS` | The staging domain only. |

**Drift rule:** any NEW variable added to production must be added to this table
(with its staging policy) in the same milestone. This file is the drift guard.

## 3. Promotion workflow (every milestone)

1. Milestone completed in the Replit workspace: tests green, architect-reviewed,
   completion report written.
2. **Push to `staging`** (Git panel → change branch to `staging` → Push, or merge
   `main`→`staging` in GitHub). Railway staging auto-deploys; migrations run
   against the staging DB — the first non-dev database they touch.
3. **Smoke pass on staging** (section 4).
4. CEO approval.
5. **Promote:** merge `staging` → `main` (GitHub "New pull request" staging→main,
   or Git panel on `main` → Push). Railway production auto-deploys.

Nothing reaches `main` that didn't run on staging first.

## 4. Staging smoke pass (~10 minutes)

- [ ] `https://<staging-domain>/api/health` returns `"environment": "staging"`.
- [ ] The amber **"Staging environment — test data only"** banner is visible.
- [ ] Log in with the staging admin account.
- [ ] Morning briefing loads for a staging brand.
- [ ] One AI generation succeeds (confirms keys + cap wiring).
- [ ] New feature flags for this milestone verified DARK (unless the milestone enables them).
- [ ] Stripe test checkout completes with card `4242 4242 4242 4242`.
- [ ] No errors in the Railway deploy logs.

## 5. Rollback

- **Code:** Railway → the service → Deployments → previous deployment → Redeploy.
  ~2 minutes, both services keep history.
- **Schema:** migrations are additive-only by house rule, so old code safely
  ignores new columns/tables. Any destructive migration requires its own
  CEO-approved plan before it exists.

## 6. Data policy

- Staging data is **synthetic only**: the demo-seed machinery + hand-made staging
  brands. **No production customer data is ever copied to staging.**
- Quarterly: delete and recreate the staging Postgres instance, redeploy, and let
  the fresh-DB bootstrap rebuild it. This verifies the bootstrap path AND
  enforces the data policy.

## 7. How the app knows it's staging

`EchoAI/config/environment.js` — `APP_ENV` always wins. With `APP_ENV=staging`:
- `/api/health` reports `environment: "staging"`; the client shows the amber banner.
- Every response carries `X-Robots-Tag: noindex, nofollow` (never indexed).
- `isProduction()` is false → paid AI requires `DEVELOPMENT_AI_ENABLED=true` and
  is capped by `AI_BUDGET_DEV_DAILY_USD` — the staging cost guard.
