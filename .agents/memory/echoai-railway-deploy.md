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
