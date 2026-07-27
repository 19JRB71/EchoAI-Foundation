# DEPENDENCY_REPORT.md

_Zorecho / EchoAI full-system review package — spec §6._
_Prepared 2026-07-24. From `EchoAI/package.json` and `EchoAI/client/package.json`. Major dependencies only. **No upgrades were performed.**_

## Server (`EchoAI/package.json`)

- **Runtime:** Node `20.x` (`engines`), CommonJS (`"type": "commonjs"`). Entry `server.js`.
- **Lock file:** No `package-lock.json` was observed in `EchoAI/` root during this review (the client has its own `package-lock.json`). (Confirm at packaging — if absent, note it as a reproducibility gap.)

| Dependency | Version | Why it's used / feature | Essential? | Overlap / notes | Risk if changed |
|---|---|---|---|---|---|
| `@anthropic-ai/sdk` | ^0.110.0 | Claude content generation (writing brain) — `config/anthropic.js` | Yes | None; Hermes uses raw `fetch` (no SDK) | High — core AI content path; API shape changes across majors |
| `openai` | ^4.77.0 | Whisper STT, TTS, `gpt-image-1` images — `config/openai.js` | Yes (voice/image) | Overlaps ElevenLabs for TTS (dual TTS) | High — voice/image break if API changes |
| `express` | ^4.21.2 | HTTP server / routing — `server.js`, all routes | Yes | None | High — whole API |
| `pg` | ^8.13.1 | PostgreSQL driver — `config/db.js`, all data access | Yes | None | High — all persistence |
| `connect-pg-simple` | ^10.0.0 | PG-backed `express-session` store — `server.js` | Yes (OAuth state) | Pairs with `express-session` | Medium — FB OAuth state/session |
| `express-session` | ^1.19.0 | Sessions (OAuth `state` CSRF) — `server.js` | Yes | Pairs with `connect-pg-simple` | Medium |
| `jsonwebtoken` | ^9.0.2 | JWT auth — `middleware/auth.js` | Yes | None | High — auth |
| `bcrypt` | ^5.1.1 | Password hashing — `controllers/authController.js` | Yes | None (native build) | High — login; native addon can complicate deploy |
| `express-rate-limit` | ^8.5.2 | Global + auth rate limiting — `server.js`, `routes/authRoutes.js` | Yes | None | Medium — abuse protection |
| `cors` | ^2.8.6 | CORS policy — `server.js` | Yes | None | Medium |
| `stripe` | ^17.5.0 | Billing/subscriptions + webhook — subscription controller/routes | Yes (billing) | None | High — payments; webhook signature tied to raw body |
| `twilio` | ^6.0.2 | Phone/SMS agent — phone/SMS utils & controllers | Yes (voice/SMS) | None | High for phone features |
| `facebook-nodejs-business-sdk` | ^21.0.0 | Facebook/Meta ads + posting — `utils/facebookApi.js` | Yes (FB) | None | High for FB features; frequent Graph API version churn |
| `nodemailer` | ^6.9.16 | Outbound email (SMTP) — `utils/email*.js` | Yes (email) | Pairs with imapflow/mailparser (inbound) | Medium/High for email |
| `imapflow` | ^1.4.6 | Inbound email (IMAP) — Echo email assistant | Yes (email inbox) | Pairs with `mailparser` | Medium |
| `mailparser` | ^3.9.14 | Parse fetched emails | Yes (email inbox) | Pairs with `imapflow` | Medium |
| `web-push` | ^3.6.7 | Browser push notifications | Yes (notifications) | None | Medium |
| `node-cron` | ^3.0.3 | Scheduled/background jobs — `utils/scheduler.js` | Yes (automation) | Also raw `setInterval`/`setTimeout` used elsewhere (see automation doc) | Medium — background jobs |
| `multer` | ^1.4.5-lts.1 | File uploads — `middleware/documentUpload.js`, `audioUpload.js` | Yes (uploads) | None | Medium; note multer 1.x is legacy (2.x exists) |
| `pdf-parse` | ^2.4.5 | Parse uploaded PDFs (docs/vision) | Yes (doc ingest) | None | Low/Medium |
| `morgan` | ^1.11.0 | HTTP request logging | No (convenience) | Overlaps `console` logging | Low |
| `dotenv` | ^16.4.7 | Load `.env` in dev — `require("dotenv").config()` | Yes (config) | None | Low |

### Server observations
- **Dual TTS providers** (OpenAI `tts-1` + ElevenLabs) — an intentional fallback, but a genuine dependency overlap.
- **`multer@1.x`** is on a legacy line (LTS tag); a reviewer may flag it for the 2.x migration.
- **`bcrypt`** is a native addon — deploy images must compile it (relevant to Railway/nixpacks; see `DEPLOYMENT_AND_RECOVERY.md`).
- **No ElevenLabs SDK dependency** — ElevenLabs is called via raw `fetch` in `config/elevenlabs.js` (so it doesn't appear in `package.json`). Same for Hermes/Nous.
- **No server-side testing library dependency** — tests use the built-in Node `node:test` runner.
- **No `helmet`** — see security overview (no dedicated security-header middleware).
- **No schema-validation library** (`zod`/`joi`) — validation is manual.

## Client (`EchoAI/client/package.json`)

- **Type:** ES modules; React + Vite SPA. Lock file present (`client/package-lock.json`).

| Dependency | Version | Why / feature | Essential? | Overlap / notes | Risk if changed |
|---|---|---|---|---|---|
| `react` / `react-dom` | ^18.3.1 | UI framework — entire client | Yes | None | High |
| `react-router-dom` | ^6.30.4 | Client routing — `App.jsx` | Yes | None | High |
| `vite` | ^5.3.4 | Build/dev server | Yes | None | High (build) |
| `@vitejs/plugin-react` | ^4.3.1 | React Fast Refresh/JSX for Vite | Yes | None | Medium |
| `tailwindcss` | ^3.4.7 | Styling — `tailwind.config.js` | Yes | None | Medium |
| `postcss` / `autoprefixer` | ^8.4.39 / ^10.4.19 | CSS pipeline for Tailwind | Yes | None | Low/Medium |
| `@stripe/stripe-js` | ^4.7.0 | Stripe.js loader — billing | Yes (billing UI) | Pairs with react-stripe-js | High for billing UI |
| `@stripe/react-stripe-js` | ^2.8.0 | Stripe React elements — billing | Yes (billing UI) | Pairs with stripe-js | High for billing UI |
| `lucide-react` | ^1.24.0 | Icons | No (cosmetic) | None | Low |
| `@fontsource/inter` | ^5.2.8 | Inter font | No (cosmetic) | None | Low |
| `canvas-confetti` | ^1.9.4 | Celebration effects (onboarding/first win) | No (cosmetic) | None | Low |

### Client dev dependencies
`vitest` ^3.2.4, `@testing-library/react` ^16, `@testing-library/dom` ^10.4, `@testing-library/jest-dom` ^6.5, `jsdom` ^25 — the client test stack.

### Client observations
- `lucide-react@^1.24.0` is an unusually **low** major for lucide-react (current line is much higher); a reviewer should confirm the resolved version/compat. (Flag, not a change.)
- No state-management library (Redux/Zustand) — state is React-local/context (`voice/`, `music/`, `lib/BrandingContext.jsx`, etc.).
- No data-fetching library (React Query/SWR) — a hand-rolled `client/src/api.js` is used.

## Compatibility concerns (do not change — for reviewer)

- **Express 4** in the app vs. the workspace's separate `artifacts/api-server` (unrelated TS service). The review target is the Express 4 app in `EchoAI/`.
- **Native `bcrypt`** and **`pg`** must match the Node 20 runtime in the deploy image.
- **`facebook-nodejs-business-sdk@21`** and **`stripe@17`** track specific external API versions; upstream API deprecations are the main external break risk.
- **`multer@1.x`** legacy line.

**No dependencies were added, removed, or upgraded during this review.**
