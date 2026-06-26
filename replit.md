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
  `POST /generate`, `POST /schedule`, `GET /calendar/:brandId`, `GET /performance/:brandId`.
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

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Rebuild the client after changing `EchoAI/client/`**: run `cd EchoAI/client && npm run build`, then restart the `artifacts/api-server: EchoAI` workflow. The server serves the pre-built `client/dist` (no dev HMR in the preview).
- The artifact's `development.run` runs from the artifact dir, so it uses an absolute path (`cd /home/runner/workspace/EchoAI && npm start`).
- If a port (8080) is stuck after a failed restart, free it with `fuser -k 8080/tcp` before restarting the workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
