---
name: EchoAI Railway/nixpacks deploy
description: Two boot-blockers when deploying EchoAI to Railway (nixpacks) — broken bundled npm, and optional SDK clients that crash boot.
---

# EchoAI on Railway (nixpacks) — deploy gotchas

## 1. Bundled npm is broken on the Railway builder → install with Yarn
`nodejs_20` on the Railway nixpacks builder ships npm 10.8.2, which hits the
"Exit handler never called!" bug: `npm install` crashes mid-install, **exits 0
anyway** (so the failure is invisible), and leaves `node_modules` incomplete
(e.g. `dotenv` missing) → runtime `Cannot find module` → healthcheck never passes.

**What did NOT work:** clean install (`rm -rf node_modules` first), serialized
install (`--maxsockets=1`), and upgrading npm via corepack (corepack can't
`--activate` because the Nix store is read-only; `npm --version` stayed 10.8.2).

**Fix:** install deps with **Yarn** (add `yarn` to `[phases.setup].nixPkgs`; use it
only in `[phases.install]`; the app still runs under node/npm at start).
- The Nix `yarn` package drags in its own Node (22.x) while `package.json` pins
  `engines.node` "20.x", so Yarn aborts → add `--ignore-engines`.
- Use `yarn install --production=false` (NODE_ENV=production would skip devDeps;
  EchoAI has none, but be explicit).
- Keep a hard post-install verify (`node -e "require('dotenv');..."`) so any
  partial install fails the build LOUDLY instead of shipping a broken image.

**Why:** turns a silent half-install into a loud failure and sidesteps the npm bug
entirely. **How to apply:** any nixpacks Node deploy hitting invisible install
failures / missing modules at runtime.

## 2. Optional third-party SDK clients must not be constructed at boot
`config/stripe.js` did `new Stripe(process.env.STRIPE_SECRET_KEY)` at module load.
The Stripe SDK **throws at construction** when the key is missing ("Neither apiKey
nor config.authenticator provided"), which crashes the ENTIRE server on boot even
though billing is optional (only DATABASE_URL/JWT_SECRET/SESSION_SECRET/
ENCRYPTION_KEY are boot-critical).

**Fix:** build the real client only when the key exists; otherwise export a Proxy
stub that throws a clear "not configured" error **only when actually invoked**.
Server boots; every non-billing feature keeps working.

**Note:** the OpenAI (`openai`) and Anthropic (`@anthropic-ai/sdk`) SDKs do NOT
throw on a missing key — they defer to call time — so their boot-time
construction is safe. Stripe is the odd one out.

**Why:** optional features must degrade gracefully, never fail-boot. **How to
apply:** before adding any `new SomeSDK(key)` at module top-level, confirm it
tolerates a missing key or guard it like Stripe.

## 3. Prod CORS allowlist blocked the app's OWN assets → blank page
Symptom: `curl` of every route returned valid 200 HTML/JS/CSS, the identical
committed `client/dist` bundle rendered perfectly locally, yet the deployed site
was a blank white page in every real browser (incognito + headless too).

**Root cause:** the prod CORS callback rejected any `Origin` not in
`REPLIT_DOMAINS`/`ALLOWED_ORIGINS`. On Railway those are unset, so the app's own
domain wasn't allowlisted. A top-level navigation sends no `Origin` (so the HTML
loaded), but the page's `<script type="module" crossorigin>` fetches the JS
bundle *with* an `Origin` header → 403 → JS never executes → blank. `curl` never
sends `Origin`, which is why every curl looked healthy and masked the bug.

**Fix:** always allow **same-origin** requests — compare `Origin` to
`http(s)://${req.headers.host}` and pass before the allowlist check. Safe by
definition; cross-origin stays allowlist-gated. Works on any deploy domain with
zero env config.

**Why:** same-origin asset loads must never be CORS-gated. **How to apply:** the
"curl 200 but browser blank" combo on a new domain = CORS blocking own assets;
test with `curl -H "Origin: https://<domain>" .../assets/<file>.js` — a 403 there
confirms it.

## 4. Feature env vars come in PAIRS/sets — a fresh deploy needs the full list
Symptoms on a fresh Railway env (each looked like a bug, all were missing vars):
- "invalid username or password" → no admin exists; the boot admin seeder is a
  no-op without BOTH `ADMIN_EMAIL` + `ADMIN_PASSWORD`.
- "AI provider could not continue" → `ANTHROPIC_API_KEY` unset.
- Echo speaks with the WRONG voice → ElevenLabs TTS silently fell back to OpenAI
  because it needs BOTH `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`
  (`config/elevenlabs.js` `ttsConfigured()`). A key alone is not enough, and the
  fallback masks the misconfig (voice "works" but sounds different).

**Why:** graceful degradation hides missing config — nothing errors loudly, the
feature just behaves subtly wrong. **How to apply:** when standing up a new
environment, copy the full feature-var sets, not single keys; if a degradable
feature "works but wrong", suspect the *partner* var of an already-set key.
Also: the voice ID is a short ~20-char code — easy to confuse with the API key
(long, `sk_`-prefixed).
