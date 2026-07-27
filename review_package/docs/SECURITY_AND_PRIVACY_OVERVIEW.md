# SECURITY_AND_PRIVACY_OVERVIEW.md

_Zorecho / EchoAI full-system review package — spec §16._
_Prepared 2026-07-24. Verified against current code in `EchoAI/`. No exploit instructions included. No secret values included._

## Authentication

- **Mechanism:** JWT bearer tokens. Verified in `EchoAI/middleware/auth.js` via `jwt.verify(token, process.env.JWT_SECRET)`. Missing/malformed/expired tokens → `401`.
- **Password hashing:** `bcrypt` (`controllers/authController.js`, `bcrypt.hash` on register/password-change, `bcrypt.compare` on login). `SALT_ROUNDS` constant used.
- **Session invalidation on password change:** `middleware/auth.js` (lines ~83–94) rejects any token whose `iat` predates `users.password_changed_at` (minus a 2s grace window). Changing the password logs out all other sessions. Tested by `test/changePassword.test.js`.
- **Brute-force protection on credentials:** `routes/authRoutes.js` applies a stricter `express-rate-limit` (`AUTH_RATE_LIMIT_MAX`, default **10** per 15 min, `skipSuccessfulRequests: true`) to `/register`, `/login`, `/waitlist`, and password change. The global `/api` limiter is far more generous.
- **Server-side session store:** `express-session` backed by `connect-pg-simple` (PostgreSQL `session` table), used mainly to hold the Facebook OAuth `state` (CSRF) across the redirect. `SESSION_SECRET` is **required** — `server.js` throws at boot if unset. Cookie `httpOnly: true`, `sameSite: "lax"`.

## Authorization & roles

- **Workspace remapping** (`middleware/auth.js`): a user acts as owner of their own workspace by default. Active team members are transparently remapped so data scoping uses the **owner's** `userId` (`req.user.userId`) while identity/audit uses `req.user.actualUserId`. Skipped for the mobile API (`/api/v2*`) and for platform admins.
- **Roles** (`middleware/rolePermissions.js`): rank order `sales_rep = viewer (1) < manager (2) < admin (3) < owner (4)`. Platform admin (`users.role = 'admin'`, surfaced as `req.user.isPlatformAdmin`) bypasses all checks.
  - `requireRole(minRole)` — minimum workspace role gate (e.g. billing/team = admin+).
  - `denyReadOnlyMutations` (alias `denyViewerMutations`) — managers/viewers/sales_reps get GET only; POST/PUT/PATCH/DELETE require admin+.
  - `denySalesRep` — sales reps blocked from full lead list, unmasked phone numbers, other sections.
  - `requireSalesRep` — restricts the rep console to sales reps.
  - `requireOwner` — destructive account-level actions (e.g. account deletion) are owner-only; a team admin is blocked.
- **Admin panel gating:** `middleware/admin.js` and `middleware/whiteLabel.js` (agency/white-label), `middleware/featureGate.js` (tier enforcement), `middleware/setupConsent.js`.

## Tenant isolation

- Data is scoped by `user_id` (workspace-owner id) throughout. Ownership is enforced by scoping queries to `req.user.userId`. Brand-scoped data additionally keys on `brand_id`.
- **Residual risk (spec §16, do not soften):** isolation depends on every controller correctly scoping by `user_id`/`brand_id`. This review did not audit all ~40 controllers line-by-line for a missing WHERE clause. **Tenant-isolation completeness is UNVERIFIED across the whole surface** — recommend a reviewer grep each controller for unscoped queries. See `OPEN_TECHNICAL_QUESTIONS.md`.

## Account lockout (billing)

- `middleware/lockout.js`: on protected routes, if a subscription has `failed_payment_at` older than `lockout_threshold_days` (default 7) with no successful payment, the account is set `is_locked = TRUE` and requests return `403`. Complements Stripe webhooks (which can't fire once billing stops).

## Secret management

- All secrets read from environment variables (`process.env.*`); never hard-coded (verified via grep — see `ENVIRONMENT_AND_INTEGRATIONS.md`). No secret **values** are committed.
- Provider clients (Anthropic, OpenAI) are built only when their key is present; otherwise a stub is used that throws an honest "not configured" error rather than crashing at boot (`config/anthropic.js`, `config/openai.js`, `utils/optionalClient.js`).

## Token / credential storage & encryption

- **AES-256-GCM** at rest for stored credentials/tokens: `utils/encryption.js`.
  - Key from `ENCRYPTION_KEY` (accepts 64-char hex or 32-byte raw); throws if unset or wrong length.
  - 12-byte random IV per encryption; stored as `iv:authTag:ciphertext` (all base64). Auth tag verified on decrypt (GCM integrity).
- OAuth access/refresh tokens for connected accounts (Facebook, Google, email) are stored encrypted with this utility. (Storage confirmed; that every writer path encrypts is **UNVERIFIED** exhaustively — recommend a reviewer confirm each integration writes ciphertext.)

## Encryption in transit

- Deployed behind HTTPS (Railway / custom domains). CORS in production restricts to `https://` origins. Plain `http://` competitor URLs are upgraded to `https` before use (`utils/competitorSiteUrl.js`).

## File-upload security

- `middleware/documentUpload.js`: `multer` with `limits.fileSize = MAX_DOC_BYTES`, `files: 1`, and a MIME-type filter.
- `middleware/audioUpload.js`: `multer` with `MAX_AUDIO_BYTES`, `files: 1`, and an `audio/*` MIME filter.
- Large-body endpoints (base64 screenshots, image reference) are explicitly allow-listed in `server.js` (`LARGE_BODY_SUPPORT_PATHS`) so the global JSON limit stays small (smaller DoS surface).

## API protection

- **CORS** (`server.js`): production restricts to `REPLIT_DOMAINS` + `ALLOWED_ORIGINS` (as `https://` origins) plus same-origin. Development allows all origins (for the preview iframe). The **embeddable chatbot widget** public endpoints (`GET /api/chatbot/config/:brandId`, `POST /api/chatbot/chat`, `POST /api/chatbot/capture` + preflight) are intentionally open to any origin with `credentials: false`; the owner-only `PUT /api/chatbot/config/:brandId` stays allowlist-gated.
- **Global rate limiting** (`server.js`): `express-rate-limit` on `/api`, `RATE_LIMIT_MAX` default **1000** per 15 min; Stripe webhook (`/subscriptions/webhook`) is exempt.
- **No `helmet`** or explicit security-header middleware (CSP, HSTS, X-Frame-Options) was found in `server.js`. (Gap — recommend a reviewer confirm whether the hosting layer adds these. Labeled here as a **KNOWN GAP**.)

## Input / output validation

- Manual validation in controllers (no schema library like `zod`/`joi` in the server `package.json`).
- SSRF-hardened URL validation: `utils/competitorSiteUrl.js` rejects private/loopback/link-local/CGNAT IPv4 & IPv6 (incl. IPv4-mapped IPv6), bare hostnames, and non-http(s) schemes; upgrades http→https; normalizes for dedup. Note: competitor sites are fetched by **Anthropic's server-side web_fetch** (runs on Anthropic infra, not ours), reducing direct SSRF exposure.
- `utils/webhookDispatcher.js` and `utils/emailAccounts.js` also contain allowlist/host-safety logic (Zapier webhooks, IMAP/SMTP hosts).

## AI-action permissions, approval gates & prompt injection

- **Admission gate on every paid AI call** (`utils/aiGate.js`, called by `config/anthropic.js`, `config/hermes.js`, `config/openai.js` before any spend): emergency switches → environment policy → rate limit → budgets. Blocked calls throw an honest `503` (`err.aiBlocked`), never mocked output. Detail in `AI_AND_INFRASTRUCTURE_COST_MAP.md`.
- **Development safety:** paid calls are blocked outside production unless `DEVELOPMENT_AI_ENABLED` is set (stops previews/rebuilds from spending credits).
- **Approval gates:** external actions (ad launch, posting, blasts) route through owner approval flows in the app (see `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md` and `AGENT_AND_DEPARTMENT_INVENTORY.md`). This doc does not re-verify each gate.
- **Prompt-injection posture:** context-assembly utilities (`utils/companyContext.js`, `utils/politicalContext.js`, `utils/realEstateContext.js`) reference injection concerns; there is context redaction (`utils/intelRedaction.js`) and a public/owner audience split for customer-facing prompts (`config/anthropic.js` `withTruthSystem`, `audience` defaulting to "customer" → public allowlist only). **A comprehensive, dedicated prompt-injection defense (e.g. input sanitization of untrusted web content before it reaches the model) was not confirmed. State: PARTIALLY IMPLEMENTED / UNVERIFIED.**

## Audit logging

- Audit-style tables exist (`models/056_autonomous_growth.sql`, `060_target_goals.sql`, `111_company_truth.sql`, `122_collaboration_bus.sql`).
- **AI usage ledger** (`utils/aiUsage.js` → `ai_usage_log`) records every paid provider call (success or failure) with brand/user/feature/cost metadata — an effective audit trail for AI spend and actions.
- General security/audit logging (login attempts, permission denials) is **not centralized**; failures are largely `console.error`. (Logging gap — see `KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`.)

## Sensitive-data logging

- Errors are logged via `console.error`; the code generally logs `err.message` rather than full payloads. No systematic redaction layer for logs was found. (UNVERIFIED that no sensitive value is ever logged — recommend reviewer spot-check.)

## Data deletion / account deletion

- Account deletion is owner-only (`requireOwner`). The exact cascade (which tables are purged vs. soft-deleted) was **not fully traced** in this review. (UNKNOWN — see `OPEN_TECHNICAL_QUESTIONS.md`.)

## Backup & recovery

- Database is PostgreSQL (managed by the hosting provider — Railway in staging/prod). Backup/restore procedure is a hosting-provider concern; see `DEPLOYMENT_AND_RECOVERY.md`. Application-level backup scripts were not found. (UNKNOWN at the app layer.)

## Known security gaps (do not soften — spec §16)

1. **No `helmet`/security-header middleware** (CSP/HSTS/X-Frame-Options) in the app.
2. **Prompt-injection defenses are partial/unverified.**
3. **Tenant isolation is enforced by convention (per-query scoping), not centrally** — completeness unaudited.
4. **No centralized security audit log** for auth/permission events.
5. **No schema-based input validation library** on the server; validation is manual and per-controller.
6. **Every-writer-encrypts-tokens is unverified end-to-end.**
