# Real Actions vs. Simulated Actions — External-Action Inventory

**This is the single most important document in the review package.** It answers one question for every place Zorecho *appears* to do something in the outside world: **does the intended external effect actually occur?**

**Method:** Every entry is traced to the CURRENT code — the exact file, function, and (where useful) line. Classifications are based on what the code *does* (does it call a real external API? is it gated behind config? is anything hard-coded/fabricated?). A DB record, success toast, or on-screen state is **never** treated as proof of a real external action.

**Date of review:** 2026-07-24. **Environment facts (from review global rules):**
- Google OAuth was **verified working end-to-end on staging 2026-07-23** by the CEO.
- Facebook staging connect **not yet tested**.
- Live external actions (FB publish/ads, Twilio calls/SMS, Stripe charges, email sends, FCM push) have **NOT been verified end-to-end in production** unless a doc says otherwise. Per the global rules, unproven-but-real-code external actions default to **"Real but untested."**

## Classification legend
| Label | Meaning |
|-------|---------|
| **Fully real and live** | Code calls the real external API AND the effect has been verified to occur. |
| **Real but untested** | Code makes a genuine external API call; the effect should occur but has not been verified end-to-end (esp. in prod). |
| **Real but incomplete** | Real API call, but the flow is missing a step / only partially wired. |
| **Partially simulated** | Mix of real call + fabricated/placeholder data. |
| **Fully simulated** | Produces plausible output without calling the external service. |
| **UI-only** | Button/screen exists; no backend external call. |
| **Placeholder** | Stub / TODO / hard-coded stand-in. |
| **Unknown** | Cannot be determined from static code. |

---

## Summary table

| # | External action | Provider | Code path | Classification |
|---|-----------------|----------|-----------|----------------|
| 1 | Publish social post (Facebook/Twitter/LinkedIn) | Meta Graph / X / LinkedIn | `utils/socialApi.publishPost` ← `socialController.publishDuePosts`/`publishPostNow` | **Real but untested** (FB); Twitter/LinkedIn Real but untested |
| 2 | Publish to Instagram / TikTok / YouTube | — | `utils/socialApi.publishPost` | **Real but incomplete** (throws "media required"; text-only unsupported) |
| 3 | Create + launch Facebook ad campaign | Meta Marketing API | `campaignController.launchFacebookCampaign` → `utils/facebookApi.graphPost` | **Real but untested** (objects created **PAUSED**) |
| 4 | Optimize / pull ad performance | Meta Marketing API | `campaignController` optimize, `optimizationController`, `adCreativeStudioController.updateCreativePerformanceForBrand` | **Real but untested** |
| 5 | Send email (transactional/report/drip/blast) | SMTP (nodemailer) | `utils/email.sendEmail`/`sendBulkEmails` | **Real but untested** (fails loudly if SMTP unset) |
| 6 | Read inbox / triage / capture leads | IMAP | `utils/emailMonitor.sweepAllEmailAccounts`, `utils/emailAccounts` | **Real but untested** |
| 7 | Send SMS | Twilio | `config/twilio.buildClient().messages.create` (smsMarketing, followUp, autonomousConversation) | **Real but untested** |
| 8 | Place outbound phone call | Twilio | `config/twilio.buildClient().calls.create` (followUpController, phoneController) | **Real but untested** |
| 9 | Receive inbound call / AI receptionist | Twilio + TwiML webhooks | `phoneController`, `config/twilio.validateTwilioRequest`/`finalizeCallCost` | **Real but untested** |
| 10 | Send mobile push | FCM (legacy HTTP) | `config/fcm.sendToTokens` ← `mobilePushController` | **Real but likely broken** (legacy FCM endpoint) |
| 11 | Send web push | Web Push / VAPID | `config/webpush` ← `pushController` | **Real but untested** |
| 12 | Charge / manage subscription | Stripe | `config/stripe`, `subscriptionController` | **Real but untested** |
| 13 | Generate image | OpenAI `gpt-image-1` | `imageController` → `openai.images.generate` | **Real but untested** (real API; live in dev) |
| 14 | Text-to-speech (Echo voice) | ElevenLabs (+ OpenAI TTS fallback) | `utils/elevenlabs.synthesize` | **Real but untested** in prod |
| 15 | AI text generation (all agents) | Anthropic Claude (+ OpenAI) | `anthropic.messages.create` across controllers/prompts | **Fully real** (core; exercised in dev/tests) |
| 16 | Pull Google reviews / analytics / search console | Google APIs | `reputationController`, `googleController`, `seoController` | **Real; OAuth verified on staging**, data pulls untested |
| 17 | Reply to Google review | Google Business Profile API | `reputationController.postGoogleReply` | **Real but untested** |
| 18 | Pull Facebook page reviews | Meta Graph | `reputationController` (Graph v19.0) | **Real but untested** |
| 19 | Jobber CRM sync (pull clients / push leads) | Jobber GraphQL | `jobberController`, `config/jobber` | **Real but untested** (503 when unconfigured) |
| 20 | Update CRM record (leads/contacts) | Internal Postgres | `crmController`, `leadController` | **Fully real** (internal DB, not external) |
| 21 | Outbound webhook (Zapier etc.) | Customer webhook URL | `zapierController.triggerWebhook` → `utils/webhookDispatcher` | **Real but untested** |
| 22 | Two-way autonomous lead conversation | Twilio SMS | `autonomousConversationController` | **Real but untested** |
| 23 | Competitor Ad Spy (live competitor ads) | Meta Ad Library | `competitorAdSpyController` | **Real but untested**; no-op without FB token |
| 24 | Analytics / ROI / reports / "campaign readiness" numbers shown in UI | Internal computation | `analyticsController`, `roiDashboardController`, demo seeders | **Mixed** — real for real brands; **SIMULATED** for demo brands |

---

## Detailed findings

### 1. Publish a social post — **Real but untested**
**Files:** `EchoAI/utils/socialApi.js` (`publishPost`, line 180) ← `EchoAI/controllers/socialController.js` (`publishDuePosts` line 866; `publishPostNow` line 992).
- Facebook: real HTTP `POST` to `https://graph.facebook.com/<ver>/<pageId>/feed` (text), `/photos` (image), or `/videos` (video) with the brand's stored `access_token` (lines 185–229). Returns the real external post id, stored in `scheduled_posts.external_post_id`, status→`published`.
- Twitter: real `POST https://api.twitter.com/2/tweets` (line 233). LinkedIn: real `POST https://api.linkedin.com/v2/ugcPosts` (line 242).
- **Why not "fully real":** No evidence of a verified live publish in production; per global rules this is **Real but untested**. The mechanism is genuine (not simulated). Server tests exist (`test/publishPostNow.test.js`) but mock the HTTP layer.

### 2. Instagram / TikTok / YouTube publish — **Real but incomplete**
`socialApi.publishPost` (lines 264–271) **throws `mediaRequired(platform)`** for `instagram`/`tiktok`/`youtube` — text-only publishing is not supported by those APIs and no media-upload publish path is implemented here. Honest: it does not pretend to post.

### 3. Create + launch a Facebook ad campaign — **Real but untested (created PAUSED)**
**File:** `EchoAI/controllers/campaignController.js` `launchFacebookCampaign` (line 152) → `EchoAI/utils/facebookApi.js` `graphPost` (line 92, real Graph `fetch` with retry/backoff line 24).
- Makes **three real Marketing-API POSTs**: `act_<id>/campaigns`, `act_<id>/adsets`, and (only if `FACEBOOK_PAGE_ID` + `FACEBOOK_LINK_URL` env set) `act_<id>/adcreatives` (lines 161–214).
- **Critical honesty point:** the Facebook campaign + ad set are created with **`status: "PAUSED"`** (lines 166, 182) — "nothing spends until reviewed at Facebook" (comment lines 145–147). The **local `campaigns` row is inserted `active`** (line 222). So the UI can show an "active" campaign while **nothing is actually spending on Facebook** until a human unpauses it there. Reviewer should note this intended-vs-perceived gap.
- Shared by the manual create endpoint AND Autopilot's approve-ad path (comment line 144). Real but **untested end-to-end** in prod; also depends on env-configured page/link for the creative step (otherwise campaign+adset exist with no creative → **Real but incomplete** in that config).

### 4. Ad optimization / performance pull — **Real but untested**
`campaignController` optimize (line 296+), `optimizationController.autoOptimizeCampaignsForBrand`, `adCreativeStudioController.updateCreativePerformanceForBrand` pull real Facebook insights via `facebookApi`. Runs in `weekly-analytics` cron (OFF by default). Untested in prod.

### 5. Send email — **Real but untested**
**File:** `EchoAI/utils/email.js` `sendEmail` (line 44). Real nodemailer SMTP transport built from `SMTP_HOST/PORT/USER/PASS` env (lines 24–31). **Fails loudly** (warns + throws) when SMTP unset — does not fake success. Retries with linear backoff (`MAX_RETRIES`, default 3, lines 50–72) and ledgers each send (`recordCommsUsage`). Used by weekly reports, drip sequences (`drip-emails` cron), blasts (`email-blasts` cron), beta sweep, auth flows. Real mechanism; delivery **untested end-to-end**.

### 6. Inbox read / triage — **Real but untested**
`utils/emailMonitor.sweepAllEmailAccounts` (run by `email-inbox-sweep` cron, every 15 min, AI-gated) fetches new mail per connected IMAP account, AI-triages, alerts, and captures leads. Real IMAP + real Claude triage. Untested end-to-end in prod.

### 7–9. Twilio SMS, outbound & inbound calls — **Real but untested**
**File:** `EchoAI/config/twilio.js` `buildClient` (line 43) returns a real, **instrumented** Twilio REST client (usage ledgered per `messages.create` / `calls.create`).
- SMS: `smsMarketingController` (lines 341, 617), `followUpController` (line 549), `autonomousConversationController` (line 156). Real `messages.create`.
- Outbound calls: `followUpController` (line 502) `calls.create`; `phoneController` for AI sales/receptionist.
- Inbound/webhooks: `phoneController` handles TwiML; `validateTwilioRequest` verifies `X-Twilio-Signature` (line 148); `finalizeCallCost` reconciles real billed minutes (line 105). Twilio is connected **per brand** (each owner supplies their own account SID/auth token — no global key). Real mechanism; **untested end-to-end** in prod and only functional for brands that connected Twilio.

### 10. Mobile push (FCM) — **Real but LIKELY BROKEN**
**File:** `EchoAI/config/fcm.js` `sendToTokens` (line 25). Real `fetch` — BUT to the **legacy FCM HTTP endpoint** `https://fcm.googleapis.com/fcm/send` with `Authorization: key=<FCM_SERVER_KEY>` (lines 14, 44–58). **Google has deprecated/retired the legacy FCM API.** When configured, calls will most likely return non-2xx and be counted as `failed` (lines 68–71) — silently, since it never throws. **Flag for reviewer as probable breakage.** No-ops cleanly when `FCM_SERVER_KEY` unset. (This is separate from and less reliable than the VAPID web-push path.)

### 11. Web push (browser) — **Real but untested**
`EchoAI/config/webpush.js` uses the `web-push` library with VAPID keys (env `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`). Gracefully disables when unconfigured. Includes an **SSRF allowlist** restricting push endpoints to known browser push hosts (lines 30–51). Real mechanism; delivery untested end-to-end.

### 12. Stripe billing — **Real but untested**
`EchoAI/config/stripe.js` constructs a real Stripe SDK client from `STRIPE_SECRET_KEY` (line 14); when unset it swaps in an **unconfigured client that fails on use** (line 21) — billing disabled, never faked. `subscriptionController` + `webhookRoutes` handle checkout/subscription/webhook events. Real mechanism; end-to-end charge flow untested per global rules. **Verify Stripe webhook signature verification** in `subscriptionController`/`webhookRoutes` (UNVERIFIED here).

### 13. Image generation — **Real but untested (live in dev)**
`EchoAI/controllers/imageController.js` calls `openai.images.generate` with `OPENAI_IMAGE_MODEL` default `gpt-image-1` (lines 26, 278). Handles `b64_json` inline bytes, persists to disk, SSRF-guards source URLs (allowlist incl. `.openai.com`, line 40; source fetch line 614). Genuine external call.

### 14. Text-to-speech — **Real but untested in prod**
`EchoAI/utils/elevenlabs.js` `synthesize` (line 71): real `POST` to ElevenLabs streaming TTS (line 84) with `ELEVENLABS` env config; distinguishes 4xx "reachable but refused" (surface) from 5xx/network (fall back to OpenAI TTS). `generateSound` for wake-up sting. Ledgered per synthesis. Real mechanism.

### 15. AI text generation — **Fully real**
Ubiquitous `anthropic.messages.create` across `controllers/*` and `prompts/*` (see grep list in `AI_PROMPT_INVENTORY.md`). This is the platform's core and is exercised by dev usage + the test suite (tests stub it). Classified **Fully real** (the call genuinely hits Claude when not stubbed). Some paths fall back to OpenAI. Model IDs/costs are covered in `AI_AND_INFRASTRUCTURE_COST_MAP.md`.

### 16–18. Google & Facebook reputation/analytics pulls
- **Google reviews:** `reputationController.js` calls real Google Business Profile REST APIs — `mybusinessaccountmanagement`, `mybusinessbusinessinformation`, `mybusiness v4/.../reviews` (lines 44–83). **Google OAuth verified on staging 2026-07-23**, but the specific review/analytics data pulls are **untested**. → Real but untested (OAuth layer verified).
- **Google reply:** `postGoogleReply` targets `/v4/.../reply` (real PUT/POST). Real but untested; **note: this posts a public reply to a real customer review — do not test destructively.**
- **Facebook page reviews:** real Graph v19.0 call (line 12, 100). No-ops with a clear error when FB not connected. Real but untested.
- **Google Analytics / Search Console / Ads:** OAuth scopes present in `config/google.js` (lines 23–39); pulls in `seoController`/`googleController`. Real but untested.

### 19. Jobber CRM sync — **Real but untested**
`config/jobber.js` + `controllers/jobberController.js`: real OAuth 2.0 + GraphQL against `api.getjobber.com` (pinned API version). Surfaces a clear **503 "not configured"** when `JOBBER_CLIENT_ID/SECRET` unset (never fakes). `tests/jobber.test.js` exists (mocked). Real but untested in prod.

### 20. CRM record update — **Fully real (internal)**
`crmController`/`leadController` write to internal Postgres. Not an external action; fully real within the app DB.

### 21. Outbound webhook — **Real but untested**
`zapierController.triggerWebhook` → `utils/webhookDispatcher.js`: real `fetch` to the customer's stored `webhook_url` (line 58) **behind an SSRF guard** (`assertSafeWebhookTarget`, line 46) with retry on failure. Fired fire-and-forget from crons (e.g. weekly report). Real but untested.

### 22. Two-way autonomous lead conversation — **Real but untested**
`autonomousConversationController` sends replies via real Twilio SMS (`buildClient(...).messages.create`, line 156) and is closed out by the `autonomous-timeout-sweep` cron after 48h silence. Real messaging mechanism.

### 23. Competitor Ad Spy — **Real but untested; honest no-op without token**
`competitorAdSpyController` pulls each confirmed competitor's live Facebook ads via the Meta Ad Library. **No-ops entirely with no Facebook token — nothing fabricated** (scheduler comment lines 355–357). Enterprise-gated. Real but untested.

### 24. Demo-brand numbers vs real numbers — **SIMULATED for demo brands**
This is a key "do not be fooled" case. For **demo brands** (`is_demo = true`), analytics, leads, ROI, and campaign figures are **seeded/simulated** (`utils/demoSeeder.js`, `config/demoScript.js`, `config/demoSuggestions.js`) so the product demos convincingly. Every background sweep explicitly **excludes demo brands** (`WHERE is_demo = false` throughout `scheduler.js`). For **real brands**, analytics/ROI are computed from real data (which in turn depends on the real integration pulls above being configured). A reviewer evaluating the UI must confirm whether they are looking at a demo brand (numbers are SIMULATED) or a real brand.

---

## Cross-cutting honesty notes

1. **"Active" locally ≠ live externally.** The clearest example is #3: Facebook campaigns/ad sets are created **PAUSED** while the local row is **`active`**. Nothing spends until a human unpauses at Facebook. Treat any "campaign launched / active" UI state as **local state**, not proof of live ad spend.
2. **Graceful-degradation stubs are honest, not fake success.** Stripe (`makeUnconfiguredClient`), FCM (`skipped:true`), Web Push (`isConfigured=false`), Jobber (503), email (warn+throw), ElevenLabs/Facebook (throw with clear message) all **fail or no-op visibly** when unconfigured rather than fabricating success. Good.
3. **FCM legacy endpoint (#10) is the most likely genuinely-broken external action.** Highlighted for the reviewer.
4. **Nothing in production has been proven end-to-end** except Google OAuth on staging. Every "Real but untested" above needs a controlled, non-destructive live test before being trusted (and #17 Google review reply / #7–9 Twilio / #12 Stripe are **destructive/cost-incurring** — do not test carelessly).
5. **Per-brand credentials.** Twilio, social tokens, email accounts, Jobber, and (for ads) Facebook are connected per brand. A given action is only "real" for a brand that has actually completed that connection; otherwise the code no-ops or errors cleanly.

---

*Prepared for outside architect audit — Zorecho Full System Review, 2026-07-24. Every classification is traceable to the cited file/function. Per review rules, external actions that are genuinely coded but not verified end-to-end in production are labeled "Real but untested" rather than "Fully real."*
