# PROMPT 026 — Owner-Assisted Pre-Stage-2 Fix/Verification Session Report

**Date:** 2026-08-14 (owner-assisted, one step at a time)
**Scope:** Priorities 1–5 of the pre-Stage-2 package. Stage 2 remains NOT authorized.
**Rule compliance:** read-only everywhere except the two authorized DNS additions at GoDaddy and the custom-domain attach on Railway (owner-executed, owner-confirmed at each step). No code changes, no migrations, no OAuth changes, no provider writes, no emails sent, no tenants created.

---

## PRIORITY 1 — Production domain (F-1/F-2): RESOLVED ✅

**Intended architecture (from project record, not guessed):** `app.zorecho.com` = production app, served by Railway service **EchoAI-Foundation**, project **calm-purpose**, environment **production**, repo EchoAI-Foundation branch `main` (auto-deploy). Sources: `EchoAI/STAGING_ENV.md` §0, `ROLLBACK.md`, review package deployment docs.

**Root cause of F-1:** the production Railway service had **no custom domain attached at all** — only `echoai-foundation-production-edd8.up.railway.app`. NXDOMAIN was expected; GoDaddy had no `app` record and nothing conflicting.

**Fix executed (owner, step-confirmed):**
1. Railway → EchoAI-Foundation (production) → Networking → added custom domain `app.zorecho.com`, port 8080.
2. GoDaddy DNS (zorecho.com): added `CNAME app → 3je00prk.up.railway.app` and `TXT _railway-verify.app → railway-verify=c85f5489…` (Railway-provided). No existing records modified or deleted. (GoDaddy threw a transient "Error processing request" on first attempts; page refresh + manual typing resolved it.)

**Verification (2026-08-14 ~14:23 UTC):**
- DNS propagated within minutes (Google DoH: CNAME → 3je00prk.up.railway.app).
- Railway issued TLS in ~3 minutes; certificate valid.
- `https://app.zorecho.com/api/health` → **HTTP 200** `{"status":"ok", "environment":"staging", "version":"592c5144…"}`.

**F-2 (apex zorecho.com):** GoDaddy `A @ → Parked` record confirmed as the source of the parking page. Not touched this session; apex intent remains an open owner decision.

---

## PRIORITY 2 — Production config verification (read-only)

- **F-6 (variable names): PASS.** 22 service variables recorded by name: AI_BUDGET_DEV_DAILY_USD, ANTHROPIC_API_KEY, APP_ENV, DATABASE_URL, DEVELOPMENT_AI_ENABLED, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ENCRYPTION_KEY, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, OPENAI_API_KEY, SESSION_SECRET, STRIPE_PRICE_ENTERPRISE, STRIPE_PRICE_PRO, STRIPE_PRICE_SEAT, STRIPE_PRICE_STARTER, STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY, VITE_STRIPE_PUBLISHABLE_KEY. **No FACEBOOK_LINK_URL, no FACEBOOK_PAGE_ID.** No values viewed except APP_ENV (non-secret, see below).
- **F-7 (migration parity): UNVERIFIED.** No read-only access path to the production database exists from this workspace; recorded honestly per package rules.
- **F-8 (what is live): ANSWERED.** Service EchoAI-Foundation / calm-purpose / production env / branch `main` / SHA `592c5144c18ff970bb790b4b0306313548ae2648` ("Add prompt index status values reference file" — in `main` history), now serving app.zorecho.com on port 8080.
- **F-9 (OAuth callbacks): FAIL both providers — production callbacks MISSING.**
  - Google (client "Zorecho Web", project echoai-501600 / 512879708312): only `https://staging.zorecho.com/api/google/oauth/callback` authorized.
  - Meta (app Zorecho, ID 1747619749738868, Live): only `https://staging.zorecho.com/api/facebook/oauth/callback` in Valid OAuth Redirect URIs.
  - No changes made (requires separate owner ruling).
- **F-10 (email transport, config only): FAIL — no email transport configured on production.** No RESEND_API_KEY / SMTP variables at all. No email sent (smoke email remains Stage 2).

## STOP-AND-REPORT LIST (owner rulings required; nothing done)

1. **APP_ENV=staging on the production service** (value confirmed via eye-toggle; root cause of the "environment: staging" health label). Fix = edit one variable to `production`; triggers redeploy and may change env-gated behavior.
2. **Google OAuth:** add `https://app.zorecho.com/api/google/oauth/callback` to client "Zorecho Web" authorized redirect URIs.
3. **Meta OAuth:** add `https://app.zorecho.com/api/facebook/oauth/callback` to Zorecho app → Facebook Login for Business → Valid OAuth Redirect URIs.
4. **Email transport on production:** no variables present; needs RESEND_API_KEY (or chosen transport) before production can send any email.
5. **Dev-flavored variables on production:** DEVELOPMENT_AI_ENABLED and AI_BUDGET_DEV_DAILY_USD present (variables appear copied from staging); review intent.
6. **No STRIPE_WEBHOOK_SECRET on production** — Stripe webhooks cannot be verified in prod.
7. **Apex zorecho.com intent** (currently GoDaddy-parked) — owner decision outstanding.

---

## PRIORITY 3 — SDS: NO ACTION (per owner ruling)
SDS-H1 = fresh onboarding through product surfaces in Stage 2. Nothing created this session. Pole Barn Kits remains historical, outside 026.

## PRIORITY 4 — Blacor Homes checklist: COMPLETE ✅
- **Website:** `blacorhomes.com` — live, verified HTTP 200, title "Blacor Homes".
- **Facebook Page:** "Blacor Homes" (facebook.com/profile.php?id=61560734440780, 95 followers, links to blacorhomes.com); owner is admin. Note: July 25, 2026 post shows "Published by Zorecho" — the Page has previously been connected to and posted through Zorecho.
- **Ad account:** Blacor has its **own**: "BlaCor Ads", `act_1694378501604002` (Business ID 1794228364669298), zero campaigns ever. → Blacor does NOT need to share the SDS ad chain (`act_818682760732833`); each business can carry its own.
- **GA4:** **none** (owner-confirmed "no"). Honest absence recorded; BLACOR instances will have no GA4 leg unless one is created later (not authorized here).

## PRIORITY 5 — I-29 Google refresh-token survival: PASS ✅
Read-only preflight run 2026-08-14 (day 7+ after the 2026-08-07 grant), owner JWT, staging:
`connected: true`, `hasRefreshToken: true`, and GA4 pull succeeded live (`analytics.reachable: true`, properties/473906255, hasData) — which required the refresh token to mint a fresh access token during the check. **The refresh token survived past day 7.** GBP probe still quota-blocked (known I-30, project 512879708312, case 4-9287000040750) — unrelated to token survival. No reconnect/rotation performed. Non-gating.

---

## Session integrity notes
- Staging DB touched read-only once (I-29); a first query failed on a nonexistent column name and was abandoned in favor of the preflight endpoint — no writes at any point.
- Workspace/staging/production code untouched.
- One step at a time maintained throughout; both unexpected findings (production health reporting "staging"; GoDaddy save error) were STOP-explained before proceeding.
