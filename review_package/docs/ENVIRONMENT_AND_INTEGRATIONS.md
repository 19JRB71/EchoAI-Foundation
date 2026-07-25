# ENVIRONMENT_AND_INTEGRATIONS.md

Environment variables and third-party integrations for EchoAI / Zorecho.

**Sources:** `grep` of `process.env.*` across `EchoAI/config`, `EchoAI/controllers`, `EchoAI/routes`, `EchoAI/utils`, `EchoAI/middleware`, `EchoAI/server.js`, `EchoAI/prompts`; and `import.meta.env.*` across `EchoAI/client/src`. Required/optional classification comes from `EchoAI/config/env.js` (`CRITICAL` vs `FEATURES`) and `EchoAI/config/environment.js`. Integration "live/tested" status follows the review's global rules (dev = Replit workspace; staging = staging.zorecho.com; prod = app.zorecho.com).

> **No secret values are included.** Names and purposes only.

---

## Environment detection (`config/environment.js`)

The server decides its environment (which gates money-spending background AI) in this order:
1. `APP_ENV` (explicit, always wins)
2. Any Railway marker (`RAILWAY_ENVIRONMENT_NAME` / `RAILWAY_ENVIRONMENT` / `RAILWAY_PROJECT_ID`) → **production**
3. Any Replit marker (`REPL_ID` / `REPLIT_DEV_DOMAIN`) → **development**
4. `NODE_ENV === "production"` → production
5. otherwise → development

`DEPLOY_VERSION` = `RAILWAY_GIT_COMMIT_SHA` || `RAILWAY_DEPLOYMENT_ID` || null (recorded in the usage ledger).

---

## Critical variables (server exits if missing — `config/env.js` CRITICAL)

| VARIABLE_NAME | Purpose | Required | System using it | Status |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | **Required** | `config/db.js`, all data access | Configured (dev/staging/prod) |
| `JWT_SECRET` | Signing secret for auth tokens | **Required** | `middleware/auth.js`, `authController.js`, `config/jwt`/token issuance | Configured |
| `SESSION_SECRET` | Secret for OAuth CSRF session cookies (connect-pg-simple) | **Required** | Facebook/Google OAuth flows, `session` table | Configured |
| `ENCRYPTION_KEY` | AES-256 key for encrypting stored API tokens | **Required** | `utils/encryption.js` (api_integrations, google_integrations, email_accounts, jobber_integrations) | Configured |

---

## Feature variables (missing → feature disabled gracefully / 503)

Grouped as in `config/env.js` FEATURES. "Status" = best knowledge per global rules; verify per environment.

### AI providers
| VARIABLE_NAME | Purpose | Required/Optional | System using it | Status |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Claude — brand discovery, content, most agent generation | Optional (feature) | `config/anthropic.js` | Configured (primary LLM) |
| `ANTHROPIC_MODEL` | Override Claude model id | Optional | `config/anthropic.js` | Optional |
| `OPENAI_API_KEY` | OpenAI — image gen (DALL·E/gpt-image), TTS, STT | Optional (feature) | `config/openai.js` | Configured |
| `OPENAI_IMAGE_MODEL` | Image model id override | Optional | `config/openai.js` | Optional |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | Text-to-speech model/voice | Optional | `config/openai.js` | Optional |
| `OPENAI_STT_MODEL` | Speech-to-text model | Optional | `config/openai.js` | Optional |
| `NOUS_PORTAL_API_KEY` | Hermes 4 decision brain via Nous Portal | Optional (feature) | `config/hermes.js` | Uncertain (falls back to existing behavior if absent) |
| `NOUS_PORTAL_BASE_URL` / `NOUS_HERMES_MODEL` | Hermes endpoint + model | Optional | `config/hermes.js` | Optional |
| `HERMES_TIMEOUT_MS` / `HERMES_ORCHESTRATOR_TIMEOUT_MS` / `HERMES_MAX_ATTEMPTS` | Hermes call tuning | Optional | `config/hermes.js` | Optional |
| `ENABLE_CONVERSATIONAL_CORE` | Feature flag for conversational core | Optional | `routes/conversationalCoreRoutes.js` | Flag |

### Voice (ElevenLabs)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (falls back to OpenAI TTS) | Optional (feature) | `config/elevenlabs.js` | Uncertain |
| `ELEVENLABS_VOICE_ID` | Voice id (required with the key) | Optional (feature) | `config/elevenlabs.js` | Uncertain |
| `ELEVENLABS_API_BASE` / `ELEVENLABS_MODEL_ID` / `ELEVENLABS_OUTPUT_FORMAT` / `ELEVENLABS_LANGUAGE_CODE` | ElevenLabs tuning | Optional | `config/elevenlabs.js` | Optional |

### Billing (Stripe)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe API secret | Optional (feature) | `config/stripe.js`, `subscriptionController.js` | Configured |
| `STRIPE_WEBHOOK_SECRET` | Verify Stripe webhooks | Optional | webhook route | Configured (optional) |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_PRO` / `_ENTERPRISE` / `_SEAT` | Stripe price ids per tier + per-seat | Optional | `config/plans.js`, `subscriptionController.js` | Configured (optional) |
| `STRIPE_PUBLISHABLE_KEY` | Publishable key (server-exposed) | Optional | `config/stripe.js` | Configured |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Publishable key (client build) | Optional | `client/src/lib/stripe.js` | Configured (client) |

### Email (SMTP / IMAP)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `SMTP_HOST` | Transactional email host (gates the SMTP feature) | Optional (feature) | nodemailer transport | Uncertain |
| `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP connection details | Optional | nodemailer | Uncertain |
| `EMAIL_FROM` | From address | Optional | mailers | Optional |
| `EMAIL_MAX_RETRIES` | Email retry cap | Optional | email schedulers | Optional |

> IMAP/SMTP credentials for the **Echo Email Assistant** (per-user inboxes) are stored **per account in `email_accounts`** (AES-256-GCM encrypted), not via env vars.

### Facebook (OAuth)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook OAuth app credentials | Optional (feature) | `config/facebook.js`, `facebookOAuthController.js` | Configured |
| `FACEBOOK_REDIRECT_URI` | OAuth redirect | Optional | `facebookOAuthController.js` | Optional |
| `FACEBOOK_GRAPH_VERSION` | Graph API version | Optional | `config/facebook.js` | Optional |
| `FACEBOOK_ACCESS_TOKEN` / `FACEBOOK_PAGE_ID` / `FACEBOOK_LINK_URL` | Fallback/global page token + link (legacy/global) | Optional | `config/facebook.js` | Uncertain (per-user tokens live in `api_integrations`) |

### Google (OAuth)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (Business Profile, Ads, Analytics, Search Console) | Optional (feature) | `config/google.js`, `googleController.js` | Configured |
| `GOOGLE_REDIRECT_URI` | OAuth redirect | Optional | `googleController.js` | Optional |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API access | Optional | `googleController.js` | Uncertain |
| `GOOGLE_API_KEY` / `GOOGLE_CLOUD_PROJECT` | Google API key / project (Calendar, etc.) | Optional | `config/google.js`, `config/googleCalendar.js` | Optional |

### Jobber (OAuth)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `JOBBER_CLIENT_ID` / `JOBBER_CLIENT_SECRET` | Jobber OAuth credentials (field-service CRM) | Optional (feature) | `config/jobber.js`, `jobberController.js` | Uncertain (newest integration) |
| `JOBBER_REDIRECT_URI` / `JOBBER_API_VERSION` | Jobber OAuth redirect + API version | Optional | `jobberController.js` | Optional |

### Push notifications
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (PWA) VAPID keys | Optional (feature) | `config/webpush.js`, `pushController.js` | Uncertain |
| `FCM_SERVER_KEY` | Firebase Cloud Messaging (mobile push) | Optional (feature) | `config/fcm.js`, `mobilePushController.js` | Uncertain |

### Telephony / SMS (Twilio)
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account (customer phone agent + SMS) | Optional | `config/twilio.js`, `phoneController.js`, `smsMarketingController.js` | Uncertain (per-brand config also in `twilio_config`) |
| `TWILIO_SKIP_VALIDATION` | Skip Twilio webhook signature validation (test) | Optional | Twilio webhook route | Optional (risk if on in prod) |
| `SALES_TWILIO_ACCOUNT_SID` / `SALES_TWILIO_AUTH_TOKEN` / `SALES_TWILIO_NUMBER` | Zorecho's OWN dedicated sales line (three-way call demo) | Optional (feature) | `salesAgentController.js` | Uncertain |

### Music / misc
| VARIABLE_NAME | Purpose | Required/Optional | System | Status |
|---|---|---|---|---|
| `YOUTUBE_API_KEY` | Music search (playback works without it via video IDs) | Optional (feature) | music search | Optional |

### AI cost controls & tuning
| VARIABLE_NAME | Purpose | System |
|---|---|---|
| `AI_ENABLED` / `DEVELOPMENT_AI_ENABLED` | Master AI on/off (prod vs dev) | `config/aiControls.js` |
| `AI_BUDGET_GLOBAL_DAILY_USD` / `AI_BUDGET_BACKGROUND_DAILY_USD` | Daily spend caps (global + background) | `utils/aiBudget.js`, `config/aiControls.js` |
| `AI_MAX_CALLS_PER_MINUTE` / `AI_MAX_ATTEMPTS` | Rate + retry caps | `config/aiControls.js` |
| `AI_TIMEOUT_MS` / `AI_HEAVY_TIMEOUT_MS` | AI call timeouts | `config/aiControls.js` |
| `ECHO_DEFAULT_DAILY_BUDGET` | Echo default daily budget | growth/autopilot |
| `TARGET_COST_PER_LEAD` | ROI target CPL default | `config/roiModel.js` |

### Sage V2 feature flags (default OFF)
| VARIABLE_NAME | Purpose |
|---|---|
| `SAGE_V2_CONTEXT` / `SAGE_V2_WEEKLY_BRIEFING` / `SAGE_V2_OFFERS` / `SAGE_V2_EXEC_MEMORY` (+ related `SAGE_V2_*` flags referenced in migrations 116–121: `_INTEL_STORE`, `_JOB_QUEUE`, `_SKIP_GATES`, `_DQ_SENTRY`, `_OPPORTUNITIES`, `_DIRECTIVES`, `_SCORECARDS`) | Gate the dormant Sage V2 subsystem tables/behavior. Default OFF → those tables are unexercised unless enabled. |

### Platform / infra / limits
| VARIABLE_NAME | Purpose |
|---|---|
| `NODE_ENV` / `APP_ENV` / `PORT` | Runtime env + port |
| `APP_URL` / `PUBLIC_BASE_URL` | Public base URLs (links, OAuth redirects, emails) |
| `ALLOWED_ORIGINS` | CORS allowlist |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | express-rate-limit caps (global + auth) |
| `JWT_EXPIRES_IN` / `JWT_SESSION_EXPIRES_IN` | Token lifetimes |
| `MAX_AUDIO_UPLOAD_BYTES` / `MAX_DOC_UPLOAD_BYTES` | Upload size caps |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed admin account (`utils/adminSeeder.js`) — **sensitive** |
| `FREE_TEST_MODE` | Test/free mode flag |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Alternate discrete DB config (fallback to `DATABASE_URL`) |
| `RAILWAY_ENVIRONMENT` / `RAILWAY_ENVIRONMENT_NAME` / `RAILWAY_PROJECT_ID` / `RAILWAY_GIT_COMMIT_SHA` / `RAILWAY_DEPLOYMENT_ID` | Railway-injected (environment detection + deploy version) |
| `REPL_ID` / `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS` | Replit-injected (dev detection) |

### Client build vars (Vite, `import.meta.env`)
| VARIABLE_NAME | Purpose |
|---|---|
| `VITE_API_BASE_URL` | API base URL for the client |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (client) |
| `BASE_URL` | Vite base path |

> Many other names appeared in a raw `process.env` grep (e.g. `BROWSERSLIST_*`, `JITI_*`, `VITEST_*`, `DOTENV_CONFIG_*`) — these are **tooling/build-time variables from dependencies (node_modules)**, not Zorecho application configuration, and are excluded from the tables above.

---

## Integrations manifest

Per global rules: external actions default to **"Real but untested"** unless a doc proves end-to-end success. Google OAuth was verified working end-to-end on **staging 2026-07-23** by the CEO. See REAL_ACTIONS_VS_SIMULATED_ACTIONS.md (T005) for action-level classification.

### Stripe (billing)
- **Purpose:** subscriptions, tier upgrades, per-seat billing, webhooks.
- **Auth:** secret API key (`STRIPE_SECRET_KEY`) + webhook signature (`STRIPE_WEBHOOK_SECRET`).
- **Files:** `config/stripe.js`, `config/plans.js`, `controllers/subscriptionController.js`, Stripe webhook route.
- **Live/tested/real data:** Configured; charging real cards is **Real but untested end-to-end in prod** (no proof in docs). Uses real data.
- **Limitations/failure points:** requires price ids per tier; webhook secret must match; lockout logic depends on webhook or `subscriptions.failed_payment_at` updates.
- **Setup:** set secret + price ids + webhook secret; register webhook endpoint in Stripe dashboard.

### Twilio (customer phone agent + SMS)
- **Purpose:** AI phone agent calls, two-way SMS marketing, follow-up SMS.
- **Auth:** account SID + auth token (env `TWILIO_*` and/or per-brand `twilio_config`); webhook signature validation (unless `TWILIO_SKIP_VALIDATION`).
- **Files:** `config/twilio.js`, `controllers/phoneController.js`, `controllers/smsMarketingController.js`, `controllers/followUpController.js`.
- **Live/tested/real data:** **Real but untested** end-to-end (would place calls / send SMS = money). Real data.
- **Failure points:** `TWILIO_SKIP_VALIDATION` on in prod would disable webhook auth (security risk).

### Twilio — Zorecho sales line (`SALES_TWILIO_*`)
- **Purpose:** inbound demo calls to Zorecho's own number, three-way call support.
- **Files:** `controllers/salesAgentController.js`, tables `sales_calls`, `sales_agent_config`.
- **Status:** feature-flagged by presence of `SALES_TWILIO_*`; **Real but untested**.

### Facebook (Graph API — ads + organic)
- **Purpose:** unified OAuth for Atlas (ads) and Nova (organic Page posting); per-Page access tokens (migration 088).
- **Auth:** OAuth (`FACEBOOK_APP_ID`/`_APP_SECRET`), CSRF via `session` table; tokens encrypted in `api_integrations` (+ page tokens).
- **Files:** `config/facebook.js`, `controllers/facebookOAuthController.js`, `controllers/socialController.js`, `controllers/campaignController.js`.
- **Live/tested/real data:** **Facebook staging connect NOT yet tested** (global rules). Publishing = **Real but untested**.
- **Failure points:** page-token vs user-token distinction; redirect URI must match app config.

### Google (OAuth — Business Profile, Ads, Analytics, Search Console, Calendar)
- **Purpose:** SEO tools, Google Ads plans, analytics ingestion, calendar.
- **Auth:** OAuth (`GOOGLE_CLIENT_ID`/`_SECRET`); tokens encrypted in `google_integrations`; Ads needs `GOOGLE_ADS_DEVELOPER_TOKEN`.
- **Files:** `config/google.js`, `config/googleCalendar.js`, `controllers/googleController.js`, `controllers/seoController.js`.
- **Live/tested/real data:** **Google OAuth verified end-to-end on staging 2026-07-23 (CEO).** Downstream API actions (Ads/Analytics writes) not individually proven.

### ElevenLabs (voice TTS)
- **Purpose:** Echo's spoken voice; falls back to OpenAI TTS if unset.
- **Auth:** API key (`ELEVENLABS_API_KEY`) + `ELEVENLABS_VOICE_ID`.
- **Files:** `config/elevenlabs.js`, Echo voice controllers.
- **Status:** Uncertain if configured per environment; **Real but untested** at scale.

### OpenAI (images, TTS, STT)
- **Purpose:** image generation (ad creatives, Vision), text-to-speech, speech-to-text.
- **Auth:** `OPENAI_API_KEY`.
- **Files:** `config/openai.js`, `controllers/imageController.js`, voice controllers.
- **Status:** Configured; image gen is **Real** (creates images) but usage/quality not audited here.

### Anthropic (Claude — primary LLM)
- **Purpose:** brand discovery, content, agent generation, most reasoning.
- **Auth:** `ANTHROPIC_API_KEY`; model `ANTHROPIC_MODEL`.
- **Files:** `config/anthropic.js` and most controllers/utils.
- **Status:** Configured (primary). Real LLM calls; cost-governed via `config/aiControls.js`.

### Nous / Hermes 4 (decision brain)
- **Purpose:** Echo's decision/orchestration brain via Nous Portal.
- **Auth:** `NOUS_PORTAL_API_KEY`, `NOUS_PORTAL_BASE_URL`, `NOUS_HERMES_MODEL`.
- **Files:** `config/hermes.js`.
- **Status:** Uncertain; **falls back to existing behavior when absent** (per `config/env.js`). Verify whether Hermes is actually active in prod.

### Web Push (VAPID) & FCM
- **Purpose:** PWA web push (hot-lead alerts) + mobile push.
- **Auth:** VAPID keypair; `FCM_SERVER_KEY`.
- **Files:** `config/webpush.js`, `controllers/pushController.js`, `config/fcm.js`, `controllers/mobilePushController.js`.
- **Status:** Uncertain per environment; **Real but untested**.

### SMTP / IMAP (email)
- **Purpose:** transactional email (SMTP env) + Echo Email Assistant multi-account inbox (per-account creds in `email_accounts`).
- **Auth:** SMTP env vars; per-account app passwords (encrypted) for the assistant.
- **Files:** nodemailer transport, `controllers/echoEmailController.js`, `utils/emailMonitor.js`, `utils/emailComposer.js`.
- **Status:** Uncertain if SMTP configured; **Real but untested**.

### Jobber (field-service CRM)
- **Purpose:** clients, schedule, lead push.
- **Auth:** OAuth (`JOBBER_CLIENT_ID`/`_SECRET`); token in `jobber_integrations` (encrypted).
- **Files:** `config/jobber.js`, `controllers/jobberController.js`.
- **Status:** Newest integration (migration 124); **Real but untested**.

### YouTube Data API
- **Purpose:** music search for the login/companion music widget.
- **Auth:** `YOUTUBE_API_KEY` (playback works without it via video IDs).
- **Status:** Optional; low-risk.

---

## Known cross-integration failure points (summary)
- OAuth flows (Facebook/Google/Jobber) depend on the `session` table + `SESSION_SECRET` + correct redirect URIs; a URI mismatch silently breaks connect.
- All stored third-party tokens depend on `ENCRYPTION_KEY` (AES-256-GCM, `utils/encryption.js`); rotating the key without re-encrypting orphans every stored token.
- Money-spending background AI is gated by environment detection (`config/environment.js`) + `AI_ENABLED`/budgets; a misdetected environment could enable/disable spend unexpectedly.
- `TWILIO_SKIP_VALIDATION` and any test flags must be OFF in production.

See REAL_ACTIONS_VS_SIMULATED_ACTIONS.md (T005) for the authoritative real-vs-simulated action classification.
</content>
