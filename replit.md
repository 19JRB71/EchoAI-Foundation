# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `EchoAI/` — the actual product: a standalone Node/Express (CommonJS) backend at the workspace root, NOT a pnpm-workspace artifact package.
  - `EchoAI/server.js` — Express app (port from `PORT`, default 5000). Serves the React SPA from `EchoAI/client/dist` AND the `/api/*` routes on a single origin.
  - `EchoAI/client/` — React + Vite SPA. Build with `npm run build` (outputs `client/dist`).
  - `EchoAI/routes/`, `EchoAI/utils/` — API route handlers and scheduler/admin-seeder utilities.
- `artifacts/api-server/.replit-artifact/artifact.toml` — repurposed to serve EchoAI through the shared proxy at `/` (see Architecture decisions).

## Architecture decisions

- **EchoAI is served single-origin.** `server.js` serves the built React client (static + SPA fallback) and the JSON API (`/api/*`) on one port. The client calls the API with relative paths (empty base), so no cross-origin/proxy config is needed in production or the preview.
- **The preview is wired through the artifact proxy.** EchoAI is standalone, but this workspace's preview/canvas only renders apps registered with the path-based proxy. The unused starter `api-server` artifact was repurposed (its `artifact.toml`) to run EchoAI at previewPath `/` on port 8080. Its `kind` stays `api` (the validator forbids changing an artifact's kind), which still renders a browser preview.
- The standalone webview workflows (`EchoAI Server`/`EchoAI Client`) were removed in favor of the single artifact-managed service.

## Product

EchoAI is an AI-powered SaaS marketing platform. Capabilities include Facebook ad
campaign automation, a lead-qualification chatbot, brand discovery, weekly
analytics + auto-optimization, and multi-platform social media content generation
and scheduled posting (facebook/instagram/tiktok/linkedin/twitter/youtube).

### Social media subsystem

- Routes mounted at `/api/social` (all auth + lockout protected): `POST /connect`,
  `POST /generate`, `POST /schedule`, `GET /calendar/:brandId`,
  `GET /accounts/:brandId`, `DELETE /accounts/:brandId/:platform`,
  `GET /performance/:brandId`.
- The customer dashboard exposes this via a **Social Media** sidebar section
  (`client/src/sections/SocialMedia.jsx` + `client/src/sections/social/*`) with
  four tabs: Content Calendar, AI Content Generator, Connected Accounts, and
  Performance. Per-platform brand color/monogram metadata lives in
  `client/src/sections/social/platformMeta.jsx`.
- `POST /connect` returns **502** (not 2xx) when credentials are stored but the
  platform verification fails — the row is persisted with `connection_status =
  'error'`. The dashboard treats 502 as "stored, needs attention" and reloads
  the accounts list rather than as a hard failure.
- Connected-platform credentials are stored **encrypted** (AES-256-GCM) in the
  **brand-scoped** `social_accounts` table — NOT the user-scoped `api_integrations`
  table (which has a fixed enum + `UNIQUE(user_id, platform)`). The rest of the
  feature (posts) is brand-scoped, so credentials are too.
- A node-cron job runs **every minute** to publish due scheduled posts. It claims
  rows atomically (`status -> 'publishing'` via `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`)
  so overlapping ticks cannot double-publish.
- `utils/socialApi.js` makes the real per-platform API calls. Text publishing works
  for facebook/twitter/linkedin; instagram/tiktok/youtube require a media/video
  upload and throw an explicit 422 (no silent fallback) — those posts end as
  `failed` with the error recorded in `engagement_metrics`.

### Video content subsystem

- Routes mounted at `/api/video` (all auth + lockout protected): `POST /generate`,
  `POST /scripts` (save), `GET /scripts/:brandId` (list), `DELETE /scripts/:scriptId`.
- The AI Video Content Agent (`prompts/videoContentPrompt.js`) calls Anthropic to
  produce a complete video package (hook, scenes with script+visual+on-screen text,
  CTA, music style, thumbnail concept) tailored to platform
  (facebook/instagram/tiktok/youtube) and length (short/medium/long).
- Saved packages are stored brand-scoped in the `video_scripts` table
  (`script_content` JSONB, `status` draft|published). `DELETE` enforces ownership
  by joining `video_scripts` to `brands` on the authenticated `user_id`.
- `POST /generate` maps upstream Anthropic failures (billing, rate limits) to a
  **502** with a clear message rather than a generic 500.
- The customer dashboard exposes this via a **Video Content** sidebar section
  (`client/src/sections/VideoContent.jsx` + `client/src/sections/video/*`) with
  two tabs: Script Generator and Saved Scripts. Platform badges are reused from
  `sections/social/platformMeta.jsx`.

### Email marketing subsystem

- Routes mounted at **`/api/email-campaigns`** (all auth + lockout protected):
  `POST /generate`, `POST /` (save), `POST /:campaignId/send`,
  `GET /:brandId` (list), `GET /performance/:brandId`. The path is
  `email-campaigns` — NOT `/api/email`, which is the admin-only email-test route.
- The AI Email Campaign Agent (`prompts/emailCampaignPrompt.js`) calls Anthropic
  to produce a sequence of 3–10 emails, each with subject, previewText, body (brand
  voice), callToAction, and sendTiming (Day 1/Day 3/…). Output is validated +
  normalized before it can be saved or sent (no malformed data reaches DB/SMTP).
- Migration `models/014_email_campaigns.sql`: brand-scoped `email_campaigns`
  (`email_sequence` JSONB, `status` draft|active|completed, `current_step` =
  emails sent / index of next email) + `email_sends` (one row per recipient per
  step). `current_step` drives the "next scheduled email" and the progress bar.
- **`sendCampaign` is transactional**: it `SELECT … FOR UPDATE`s the campaign row,
  re-checks `current_step`, sends the next email to all brand leads with an email,
  inserts `email_sends` rows, advances the step, then commits — so concurrent
  sends cannot double-send or skip a step. A unique index
  `(campaign_id, email_address, sequence_step)` + `ON CONFLICT DO NOTHING` is a
  DB-level idempotency backstop. The step advances **only if ≥1 email actually
  sent**; a total SMTP outage rolls back and returns 502 (no step consumed).
- `POST /generate` maps upstream Anthropic failures to a **502**. Email delivery
  uses `utils/email.js` `sendEmail` (nodemailer); requires SMTP env to be set.
- The customer dashboard exposes this via an **Email Marketing** sidebar section
  (`client/src/sections/EmailMarketing.jsx` + `client/src/sections/email/*`) with
  three tabs: Campaign Generator (expandable email cards + Save/Send buttons),
  Active Campaigns (status + progress indicator + Send Next Email), and
  Performance (open/click/unsubscribe rates table).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Rebuild the client after changing `EchoAI/client/`**: run `cd EchoAI/client && npm run build`, then restart the `artifacts/api-server: EchoAI` workflow. The server serves the pre-built `client/dist` (no dev HMR in the preview).
- The artifact's `development.run` runs from the artifact dir, so it uses an absolute path (`cd /home/runner/workspace/EchoAI && npm start`).
- If a port (8080) is stuck after a failed restart, free it with `fuser -k 8080/tcp` before restarting the workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
