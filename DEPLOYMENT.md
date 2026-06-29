# EchoAI — Production Deployment Checklist

This is the end-to-end runbook for taking EchoAI live. Work top to bottom; each
section is ordered by dependency. EchoAI is a standalone Node/Express app in
`EchoAI/` that serves both the JSON API and the pre-built React client on one
origin.

> Reference: `EchoAI/.env.example` documents every environment variable, and
> `EchoAI/README.md` documents every feature/endpoint in detail.

---

## 1. Prerequisites

- [ ] Node.js 24+ available in the runtime.
- [ ] A managed PostgreSQL database (Replit DB, Neon, RDS, etc.) reachable from
      the server.
- [ ] Accounts created for the third-party services you plan to enable:
      Anthropic, OpenAI, Stripe, Facebook/Meta, Google Cloud, an SMTP provider,
      Twilio, and Firebase (only those whose features you want live).

---

## 2. Environment variables

- [ ] Copy `EchoAI/.env.example` → `EchoAI/.env` (or set the same vars in your
      host's secret manager).
- [ ] Set the **CRITICAL** vars — the server refuses to boot without them:
  - `DATABASE_URL`
  - `JWT_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - `SESSION_SECRET` — same generator as above
  - `ENCRYPTION_KEY` — **exactly 64 hex chars**:
    `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    (Never change this after launch — it decrypts stored third-party tokens.)
- [ ] Set `NODE_ENV=production`.
- [ ] Set `PUBLIC_BASE_URL`, `APP_URL`, and `ALLOWED_ORIGINS` to your real
      domain(s). In production CORS is restricted to `REPLIT_DOMAINS` +
      `ALLOWED_ORIGINS`.
- [ ] Add the API keys for each feature you want enabled (see the sections
      below). Unset feature vars degrade gracefully to 503 / "not configured".
- [ ] On boot, confirm the startup log's "Features enabled / disabled" summary
      matches your intent.

---

## 3. Database migrations (run in order)

Migrations live in `EchoAI/models/*.sql`, are numbered, idempotent, and tracked
in `schema_migrations`. The runner applies pending files in order in per-file
transactions.

- [ ] Run migrations: `cd EchoAI && npm run migrate`
- [ ] Seed the admin user: `npm run seed`
      (Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` first; change the password after
      first login.)
- [ ] Verify: the app connects and no migration errors appear in logs.

> The combined deploy command `npm run start:prod` runs migrate → build client →
> start, so steps 3 + 7 happen automatically on deploy if you use it.

---

## 4. Stripe (billing)

- [ ] Add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (live keys for prod).
- [ ] Create one recurring **monthly Price** per tier and set the IDs:
      `STRIPE_PRICE_STARTER` ($100), `STRIPE_PRICE_PRO` ($350),
      `STRIPE_PRICE_ENTERPRISE` ($550), and `STRIPE_PRICE_SEAT` ($50/seat).
- [ ] Create a webhook endpoint in the Stripe dashboard pointing to:
      `https://<your-domain>/api/subscriptions/webhook`
- [ ] Subscribe at least to: `invoice.payment_succeeded`,
      `invoice.payment_failed`, `customer.subscription.updated`,
      `customer.subscription.deleted`.
- [ ] Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
- [ ] Test with a Stripe test event and confirm a `200` (signature verified —
      the webhook route is exempt from JSON parsing so the raw body is intact).

---

## 5. Twilio (phone agent & SMS)

Twilio credentials are stored **per brand** (encrypted in the DB) via the app
UI, not as global env vars.

- [ ] Ensure `TWILIO_SKIP_VALIDATION` is unset or `false` in production so
      inbound webhook signatures are enforced.
- [ ] For each brand's Twilio number, set the webhooks in the Twilio console:
  - Voice → `https://<your-domain>/api/phone/inbound`
  - Messaging → `https://<your-domain>/api/sms/inbound`
- [ ] Confirm `PUBLIC_BASE_URL` is correct — it's used to build the webhook URLs
      that Twilio's signature is validated against.

---

## 6. Other integrations (enable as needed)

- [ ] **Anthropic**: `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`). Powers
      all AI text agents.
- [ ] **OpenAI**: `OPENAI_API_KEY` (+ image/voice model vars). Powers DALL-E
      images and voice STT/TTS.
- [ ] **Facebook/Meta**: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`,
      `FACEBOOK_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `FACEBOOK_LINK_URL`. Register
      the OAuth redirect `https://<your-domain>/api/facebook/oauth/callback` as
      `FACEBOOK_REDIRECT_URI`.
- [ ] **Google**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Register the
      redirect `https://<your-domain>/api/google/oauth/callback` as
      `GOOGLE_REDIRECT_URI`. Optional `GOOGLE_ADS_DEVELOPER_TOKEN`.

### Email (SMTP)

- [ ] Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
      and `EMAIL_FROM`.
- [ ] Verify your sending domain (SPF/DKIM) with your provider so campaign and
      transactional email lands in the inbox.
- [ ] Send a test (e.g. trigger a weekly report) and confirm delivery + that
      click-tracking/unsubscribe links resolve under `PUBLIC_BASE_URL`.

### Push notifications

- [ ] **Web push (PWA)**: generate VAPID keys once
      (`npx web-push generate-vapid-keys`) and set `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Keep them stable after launch.
- [ ] **Mobile (FCM)**: set `FCM_SERVER_KEY` from the Firebase console
      (Project settings → Cloud Messaging) to enable native push.

---

## 7. Build the client

- [ ] Build the React SPA: `cd EchoAI/client && npm run build`
      (or `cd EchoAI && npm run build`). The server serves the pre-built
      `client/dist` — there is no dev HMR in production.

---

## 8. Custom domain & TLS

- [ ] Point your domain's DNS to the host.
- [ ] Ensure HTTPS/TLS is terminated (the platform/proxy handles certs).
- [ ] Add the domain to `REPLIT_DOMAINS` (auto on Replit) and/or
      `ALLOWED_ORIGINS`, and set `PUBLIC_BASE_URL` / `APP_URL` to match.
- [ ] `trust proxy` is enabled, so client IPs (for rate limiting) and secure
      cookies work correctly behind the proxy.

---

## 9. Start the server

- [ ] Production start: `cd EchoAI && npm run start:prod`
      (migrate → build client → start), or `npm start` if you already ran
      migrate + build.
- [ ] Confirm the boot log shows the correct port and the expected enabled
      feature set, with no missing-critical-var errors.

---

## 10. Post-deploy smoke test

- [ ] Load the app over HTTPS — the SPA renders.
- [ ] Register/login works; an invalid login is eventually rate-limited (429).
- [ ] Create a brand and run brand discovery (exercises Anthropic).
- [ ] Start a subscription with a Stripe test card; confirm the webhook fires
      and the tier unlocks instantly.
- [ ] Trigger one inbound Twilio call/SMS (if enabled) and confirm a valid
      signed webhook is accepted.
- [ ] Subscribe to web push and confirm a test notification arrives.
- [ ] Verify the Monday scheduler is running (check logs after its first tick,
      or confirm it's scheduled).

---

## 11. Production hardening checklist (already built-in — verify)

- [ ] Critical env vars validated at boot (`config/env.js`).
- [ ] Global `/api` rate limit + stricter auth-endpoint limiter active.
- [ ] CORS restricted to your domains in production.
- [ ] Stripe & Twilio webhook signatures enforced.
- [ ] Third-party tokens encrypted at rest (AES-256-GCM).
- [ ] SSRF allowlists enforced on outbound user-supplied URLs.
- [ ] JSONB fields validated/serialized before DB writes.
- [ ] File uploads (voice) size- and type-limited.

---

## Rollback

- [ ] Migrations are additive/idempotent; to roll back code, redeploy the prior
      build. Avoid destructive manual SQL — restore from a database backup if a
      data issue occurs.
