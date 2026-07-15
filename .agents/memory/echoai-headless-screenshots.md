---
name: EchoAI headless screenshot staging
description: How to stage authenticated EchoAI UI states for headless-Chromium screenshots
---

- The SPA dashboard lives at `/dashboard`; `/` is the public Zorecho marketing landing page — screenshots aimed at the app must target `/dashboard`.
- `utils/token.js generateToken(payload)` signs the payload verbatim; the auth middleware reads `decoded.userId`. Mint test JWTs as `generateToken({ userId, email, role })` — passing a raw DB row (`user_id`) yields a token that half-works and surfaces as weird downstream errors (e.g. null user_id inserts).
- Working recipe: install `puppeteer-core` in /tmp (Nix chromium via `which chromium`), seed `localStorage.echoai_token` with `evaluateOnNewDocument`, set `echoai_setup_voice_mode=text` to silence voice, and use request interception to stub `/api/auth/profile` (force `onboardingCompleted:false` for wizard states) and `/api/guided-setup/state` (choose the resume step). Wizard always lands on Welcome; reach later steps by clicking "Continue where I left off".
- OAuth-return banners stage via query params from the connection catalog (`?fb=connected`, `?google=...`).

**Why:** /tmp tooling is wiped between sessions; rebuilding this from scratch cost several failed screenshot rounds.
**How to apply:** any time UI-state screenshots of EchoAI are requested.
