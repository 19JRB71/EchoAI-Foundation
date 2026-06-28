# EchoAI subsystem reference

Detailed per-subsystem deep dives. The high-level overview, cross-cutting
conventions, the compact subsystem table, feature gating, and ops notes live in
the project root `replit.md` — read that first; this file expands each subsystem.

### Sales scripts subsystem (`/api/sales-scripts`)

- **Auth + lockout.** `POST /generate`, `POST /` (save), `GET /:brandId` (list),
  `PUT /:scriptId` (edit), `DELETE /:scriptId`. Ownership via `getOwnedBrand` and
  `USING brands` / `FROM brands b ... b.user_id` joins on update/delete.
- The AI agent (`prompts/salesScriptPrompt.js`, Anthropic) takes a brand + a
  `saleType` (**cold_call / warm_follow_up / in_person_meeting**) + target persona
  + desired outcome and returns a structured JSON package: `opening`,
  `discoveryQuestions[]`, `pitch`, `objectionHandling[]`, `closingTechniques[3 —
  soft/medium/direct]`, `followUpSequence[3 — day/channel/message]`. Output is
  trimmed-then-validated (non-empty `opening`/`pitch` + all 4 arrays non-empty);
  upstream AI failures → **502**.
- Brand-scoped `sales_scripts` (`script_content` JSONB, `status` draft|published),
  migration `models/023_sales_scripts.sql`. Dashboard section
  `sections/SalesScripts.jsx` + `sections/sales/*` with two tabs (Script
  Generator, Saved Scripts).

### Zapier webhooks subsystem (`/api/webhooks`)

- **Outbound only.** EchoAI POSTs JSON event payloads to user-registered URLs
  (Zapier catch hooks, Make, Slack, etc.). No inbound Zapier actions.
- **Auth + lockout.** `POST /` (create), `POST /test` (send sample payload),
  `GET /:brandId` (list active), `DELETE /:webhookId`. Ownership via
  `getOwnedBrand(userId, brandId)` and `USING brands ... b.user_id` joins.
- **Event catalog is the source of truth.** `config/webhookEvents.js` lists the
  11 subscribable events + `isValidEvent`. The client dropdown mirrors this list
  (keep in sync). `createWebhook` rejects unknown events (400).
- **SSRF guardrail (do not regress).** `config/webhooks.js`: client-supplied
  webhook URLs must be `https`; internal hostnames (`localhost`/`.local`/
  `.internal`) and private/reserved IP literals are rejected at create time
  (`isAllowedWebhookUrl`), and re-validated at dispatch with DNS resolution
  (`assertSafeWebhookTarget` rejects names resolving to private addresses).
  Residual DNS-rebinding TOCTOU is acknowledged in-code (not closed).
- **Dispatcher.** `utils/webhookDispatcher.js` `deliver()`: 3 attempts, 10s
  `AbortSignal.timeout`, backoff `[0,1000,3000]`, logs **every** attempt to
  `webhook_delivery_logs`, never throws.
- **triggerWebhook is fire-and-forget.** `controllers/zapierController.js`
  `triggerWebhook(brandId, event, data)` looks up active subs and fans out via
  `deliver()`; it catches all errors and is called **without `await`** from
  emitting controllers so it never blocks the request/response. The `POST /test`
  route is the one place delivery is awaited → returns **502** on non-2xx.
- **Events emitted automatically:** `new_lead_created` (leadController),
  `lead_temperature_hot` (websiteChatbotController), `weekly_report_generated`
  (scheduler), `inbound_call_received` + `outbound_call_completed`
  (phoneController), `new_review_received` (reputationController). The remaining
  catalog events are subscribable but not yet wired to an emitter.
- Migration `models/024_webhooks.sql`; dashboard section
  `client/src/sections/ZapierIntegration.jsx`.

### White-label agency subsystem (`/api/agencies`)

- **Two audiences.** Platform owner (admin) creates/oversees agencies; agency
  owners self-serve their branding, customers, and revenue. `agencies` are keyed
  by `owner_user_id` (UNIQUE → one agency per account); `agency_customers` link
  customer accounts to an agency (UNIQUE `customer_user_id` → one agency per
  customer) with the `monthly_price` the agency charges.
- **Routes.** Public `GET /branding` (whiteLabel mw, **before** auth). Then
  `auth + lockout`: `GET/PUT /settings`, `POST/GET /customers`, `GET /revenue`
  (owner self-service, scoped via `getOwnedAgency(req.user.userId)`, 404 if not
  an owner). Admin-only (adds `admin` mw): `POST /` (create), `GET /all`
  (overview with per-agency customer counts + monthly revenue + JS-computed
  totals).
- **createAgency assigns ownership.** Admin-only; optional `ownerEmail` assigns
  the agency to an existing user (defaults to the authenticated admin). This is
  what makes the multi-agency admin overview + per-owner portal coherent given
  `owner_user_id` is UNIQUE. Unique violations (`23505`) → **409** (owner already
  has an agency, or domain taken).
- **Dynamic theming.** `config/whiteLabel.js` `DEFAULT_BRANDING` mirrors the
  client `lib/branding.js` defaults (amber `#f59e0b` / gray-900 `#111827`). The
  `middleware/whiteLabel.js` resolves the request host (`X-White-Label-Domain` →
  `X-Forwarded-Host` → `Host`) to an active agency's branding and attaches
  `req.agencyBranding`; it **never throws** (branding is optional). The client
  `BrandingProvider` (wraps `main.jsx`) fetches `GET /branding` once, applies CSS
  vars + `document.title`, and feeds Sidebar/Login (logo/name + primaryColor
  inline styles). Colors are strict hex; logos must be http(s) URLs; custom
  domains are bare hostnames stored lower-cased.
- **Agency-owner detection (client).** `App.jsx` calls `getAgencySettings` after
  login; a 404 simply means "not an owner" (no Agency Portal nav). Admin White
  Label panel: `client/src/admin/AdminWhiteLabel.jsx`; owner portal:
  `client/src/sections/AgencyPortal.jsx` (customers + revenue + branding form
  with live preview). Migration `models/025_white_label.sql`.

### Affiliate program subsystem (`/api/affiliates`)

- **Anyone can join.** Not brand-scoped — keyed by `user_id` (UNIQUE → one
  affiliate record per account). Affiliates earn 20% (`COMMISSION_RATE`) of a
  referred user's **first month's payment** only.
- **Attribution chain.** Landing page reads `?ref=CODE` → stores in client
  `localStorage` (`lib/referral.js`) AND calls public `POST /track/:code` which
  sets an httpOnly cookie (`utils/referralTracking.js`, no cookie-parser — manual
  header parse). `authController.register` accepts `referralCode` in the body
  (falls back to the cookie) and **awaits** `attributeSignup` after COMMIT so the
  pending `referrals` row exists before the JWT is returned (closes the
  race where a fast first-payment webhook would otherwise miss the row). Attribution
  is best-effort (try/catch — a bad code never fails signup), guards self-referral
  and inactive affiliates, and dedups via UNIQUE `referred_user_id` + `ON CONFLICT
  DO NOTHING`.
- **Conversion is first-payment-only + idempotent.** `convertReferral(userId,
  amountCents)` is called (try/catch, never fails the webhook) from the Stripe
  `invoice.payment_succeeded` case when `amount_paid > 0`. It locks the pending
  zero-commission row `FOR UPDATE` in a tx and fills `commission_amount =
  round(cents * 0.2)/100`; renewals and duplicate webhooks are no-ops (only
  `status='pending' AND commission_amount=0` matches). It is NOT an HTTP route.
- **Routes.** Public `POST /track/:code` (before auth). Then `auth + lockout`:
  `POST /register` (409 dup, retry on code 23505), `GET /profile` (404 = "not an
  affiliate"), `GET /commissions`, `POST /payout` (records PayPal email + confirms
  approved balance; **no real money moves** — owner reconciles manually). Admin
  (`admin` mw): `GET /all`, `POST /approve` (action `approve`: pending→approved /
  `pay`: approved→paid, bumps `total_paid`), `POST /suspend` (status
  active|suspended).
- **Lifecycle.** Commission `status`: pending → approved → paid, advanced by the
  platform owner. Suspended affiliates earn nothing on new signups.
- Migration `models/026_affiliate_program.sql` (`affiliates` + `referrals`,
  NUMERIC money, set_updated_at triggers). Dashboard section
  `client/src/sections/AffiliateProgram.jsx` (Dashboard/Commissions/Payouts tabs,
  visible to all users); admin `client/src/admin/AdminAffiliates.jsx`
  (Affiliates tab in AdminPanel).

### Mobile API subsystem (`/api/v2`) + `EchoAI-Mobile/`

- **Native-app backend.** A versioned, mobile-optimized API for the iOS/Android
  app, additive and independent of the web `/api/*` routes. Three mounts (before
  the SPA fallback): `/api/v2/auth`, `/api/v2/push`, `/api/v2` (data).
- **Standard envelope.** Every v2 response is `{status,data,message,pagination}`
  via `utils/mobileResponse.js` (`success`/`fail`); `pagination` is null except on
  list endpoints. Same util holds the cursor `encode`/`decode`/`paginate` helpers.
- **Auth model (`mobileAuthController.js`).** Login/register issue a **30-day**
  access JWT (same `{userId,email}` shape + `JWT_SECRET` as web, so v2 tokens also
  authorize legacy `/api/*`) **plus** an opaque refresh token (only its SHA-256
  hash stored in `refresh_tokens`). Refresh is **single-use rotation** under
  `SELECT ... FOR UPDATE` (delete+reissue in one tx). Biometric = short-lived (5m)
  JWT with a `biometric:true` claim, minted while logged in and exchanged via
  `/auth/biometric/login`. Logout revokes one device (body `refreshToken`) or all.
- **Lockout invariant holds.** `/api/v2` **data** routes enforce `auth + lockout`
  (locked/past-due → 403), same as web data routes. The intended bypass exceptions
  are `/api/v2/auth/*` (recovery) and `/api/v2/push/*` (push management) — do not
  add lockout there. **Regression watch:** never mount v2 data routes with `auth`
  alone.
- **Ownership + no-mock conventions carry over.** Dashboard/leads scope via
  `getOwnedBrand` (404 on foreign brand); leads use keyset pagination
  (`ORDER BY created_at DESC, lead_id DESC`, `(created_at,lead_id) < cursor`,
  `limit+1` probe) for stable, no-skip/no-dupe paging.
- **FCM push.** `config/fcm.js` (legacy HTTP) + `controllers/mobilePushController.js`:
  device-token upsert into `device_tokens`, `sendToUser` fans out and prunes tokens
  FCM reports invalid. **Degrades gracefully** — when `FCM_SERVER_KEY` is unset,
  registration still succeeds (`pushConfigured:false`) and sends no-op. `sendToUser`
  is **best-effort/never-throws** and every caller invokes it with `.catch(...)`
  (and without `await` in request paths) so push never blocks/fails the request.
  Wired at: hot-lead (chatbot/websiteChatbot/phone controllers), weekly report
  (`scheduler.js`), payment failed (`subscriptionController.js`).
- Migration `models/027_mobile_tokens.sql` (`refresh_tokens`+`device_tokens`).
  Full endpoint/flow docs in `EchoAI/MOBILE_API.md`.
- **`EchoAI-Mobile/` is a source-only Expo (React Native) scaffold** — NOT a
  Replit artifact, so it does not run in the preview pane. React Navigation +
  AsyncStorage; auth (login/biometric/register), Home (dashboard), Leads (cursor
  pagination), Notifications, Settings. API client (`src/api/client.js`) parses
  the envelope and does refresh-on-401. Set the backend URL via
  `EXPO_PUBLIC_API_URL` or `app.json` → `extra.apiUrl`.

### Content calendar subsystem (`/api/content-calendar`)

- **Auth + lockout** on every route. Ownership via `getOwnedBrand` (joins
  `users` for `industry` as business type — `industry` lives on `users`, NOT
  `brands`), `getOwnedCalendar`, `getOwnedCalendarPost` (all join `brands.user_id`).
- **AI agent** (`prompts/contentCalendarPrompt.js`, Anthropic):
  `generateCalendarPosts` builds a month of posts across selected platforms at a
  `postingFrequency` (`daily`/`five_per_week`/`three_per_week`), cycling
  `CONTENT_TYPES` and `DEFAULT_POSTING_TIMES`; `generateSingleCalendarPost`
  regenerates one. Output is validated (non-empty text) before persistence;
  upstream AI failures → **502**. No mocked posts.
- **Persistence.** `saveCalendar` inserts a `content_calendars` row (status
  `draft`) + its `social_posts` (with `calendar_id` FK, status `draft`) in one
  transaction (`db.getClient()`). `activate`→posts `scheduled` + calendar
  `active`; `pause`→scheduled posts back to `draft` + calendar `paused` (both
  wrapped in a transaction). Edit/regenerate guard with `status NOT IN
  ('publishing','published')` in the WHERE (race-safe vs. the scheduler) → **409**
  if already claimed.
- **Scheduler safety (belt + suspenders).** `socialController.publishDuePosts`
  only auto-publishes a calendar post when `calendar_id IS NULL OR calendar_id IN
  (SELECT calendar_id FROM content_calendars WHERE status='active')`, so pausing a
  calendar stops its posts even if a row was left `scheduled`.
- Migration `models/028_content_calendar.sql` (`content_calendar_status` enum;
  `content_calendars`; `ALTER social_posts ADD calendar_id` FK ON DELETE CASCADE;
  idempotent). Client: first tab of `client/src/sections/SocialMedia.jsx` →
  `sections/social/AICalendar.jsx` (generate form, preview grid, per-post
  edit/regenerate). The old in-app schedule view is now the "Post Schedule" tab.

### Ad creative studio subsystem (`/api/ad-studio`)

- **Auth + lockout** on every route (`router.use(auth, lockout)`). Ownership via
  `getOwnedBrand(brandId, userId)` (404 on foreign brand); `launchCreative` joins
  `ad_creatives → brands` on `b.user_id` so a foreign creative 404s.
- **AI agent** (`prompts/adCreativeStudioPrompt.js`, Anthropic): returns EXACTLY
  5 packages, each with `conceptName`, `angle`, `headline`, `bodyCopyVariations[]`,
  `imageDescription`, `videoScript{hook,scenes[],cta}`, `audienceTargeting`,
  `recommendedPlacements[]`, `callToAction`. `validateCreativePackages` trims then
  rejects empty/short output. **All upstream AI failures → 502** (the
  `anthropic.messages.create` call is wrapped; parse/validation also throw 502);
  no mocks. `saveCreative` **re-validates** client-supplied packages before
  persistence (a bad payload there is a 400, not a 502).
- **Routes.** `POST /generate` (preview, no persist), `POST /` (save draft),
  `POST /launch`, `GET /performance/:brandId` (**declared before** `GET /:brandId`
  so "performance" isn't captured as a brandId), `GET /:brandId` (library).
- **Launch reuses the Facebook campaign infra** (`utils/facebookApi.js`
  graphPost): creates campaign + ad set + ad creative all **PAUSED**, records a
  `campaigns` row (so optimizer/analytics pick it up), then marks the creative
  `launched` with `launched_package`/FB ids. **Fails fast with 503** if
  `FACEBOOK_PAGE_ID`/`FACEBOOK_LINK_URL` are unset — never reports success for a
  campaign that can't serve ads (no partial-launch state mutation). Decrypted FB
  token via `getFacebookIntegration` (`api_integrations`, status `connected`).
- **Weekly performance refresh.** `updateCreativePerformanceForBrand(brand)` pulls
  real FB insights for launched creatives; wired **best-effort** (try/catch) into
  the Monday `scheduler.js` run so a failure (e.g. no FB account) never stops it.
- Migration `models/029_ad_creatives.sql` (`ad_creatives`, `creative_concept`
  JSONB, FK brands CASCADE + campaigns SET NULL, set_updated_at trigger,
  idempotent). Client: `client/src/sections/AdStudio.jsx` (Generate / Creative
  Library / Performance tabs); api.js block + Sidebar "Ad Studio" nav.

### Customer feedback subsystem (`/api/feedback`)

- **Two AI agents** (`prompts/feedbackAnalysisPrompt.js`, Anthropic): the Survey
  Designer writes 5 on-brand questions (1 rating `id:"satisfaction"` + 4 text) for
  a `surveyType` (**post_purchase / post_call / post_chatbot / general**); the
  Feedback Analyst turns the last 30 days of responses into a report
  (`full_report`, `themes[]`, `recommendations[]`, `average_sentiment`). Output is
  validated (`validateSurveyQuestions`/`validateFeedbackReport`, `statusCode=502`)
  before persistence; all upstream AI failures → **502**. No mocks.
- **Public response page (no auth, before `router.use(auth,lockout)`).** `GET
  /r/:responseId` server-renders an HTML survey form (`pageShell`, `escapeHtml` —
  no client bundle); `POST /r/:responseId` accepts form-encoded OR JSON. Recording
  is **race-safe/idempotent**: a single `UPDATE ... WHERE answers IS NULL` is the
  source of truth — a zero-row update on an existing row means already-answered →
  **409** (do not re-add a stale pre-read `answers` check). `answers IS NULL` =
  "sent/awaiting"; `sentiment_score` (1-10 CHECK) is derived from the rating answer.
- **Auth + lockout** on all other routes. Ownership via `getOwnedBrand` /
  `getOwnedSurvey` (joins `brands.user_id`). `sendSurvey` **re-validates a
  client-supplied `leadId`** belongs to the survey's brand (join `leads` on
  `brand_id`) → 404 — never trust the cross-resource id.
- **Auto-send is fire-and-forget / never-throws.** `autoSendSurvey({brandId,
  surveyType,...})` finds-or-creates a fixed **2-question** auto survey, dedupes
  the same recipient within 24h, and delivers by email/SMS; wrapped in try/catch so
  it never blocks/fails the host request. Wired (without `await`) into
  websiteChatbotController (post_chatbot, after hot-lead), phoneController
  (post_call SMS), and `scheduler.js` (general to owner after the weekly email +
  best-effort `generateFeedbackReportForBrand` per brand).
- Migration `models/030_feedback.sql` (`surveys`, `survey_responses`,
  `feedback_reports`; reuses `set_updated_at()`; idempotent). Client:
  `client/src/sections/Feedback.jsx` (Dashboard / Responses / Surveys tabs);
  api.js block + Sidebar "Feedback" nav.

### Team & role permissions subsystem (`/api/team`)

- **Workspace remap is the core mechanism.** `middleware/auth.js`, after JWT
  verify, looks up an **active** `team_members` row where `invited_user_id = me`.
  If found it sets `req.user.userId = account_owner_user_id` (the effective
  workspace), keeps `req.user.actualUserId` (the real signed-in user), and stamps
  `workspaceRole` + `isTeamMember=true` + `isPlatformAdmin`. This makes every
  existing `userId`-scoped query workspace-scoped with **zero per-controller
  edits**. The lookup is `try/catch` → falls back to self on any error.
- **Identity-sensitive writes must use `actualUserId`, never the remapped
  `userId`.** `getProfile`, `updateProfile`, `updateOnboarding`, and the team
  controller act on `actualUserId` — otherwise a team member would edit the
  **owner's** account. **Regression watch:** any new self-account mutation in
  `authController` must use `actualUserId`.
- **v2 keeps real identity.** `auth.js` skips the remap for `/api/v2*` (mobile).
  Team members on mobile therefore operate in **their own** account, not the
  owner's workspace — cross-workspace mobile access is intentionally unsupported
  (safe: no foreign-workspace data is reachable), not a gate to add later without
  scoping the v2 data routes too.
- **Roles & gating.** Rank `viewer < manager < admin < owner`; platform admin
  (`users.role='admin'`) bypasses all. `middleware/rolePermissions.js`:
  `requireRole(min)`, `denyViewerMutations` (blocks non-GET for viewers),
  `requireOwner`. Applied: `denyViewerMutations` on campaign/social/
  content-calendar/video/phone/lead routes; `requireRole('admin')` on
  subscription mgmt/billing mutation routes + all `/api/team` mgmt routes.
- **Invitations.** `POST /invite` (admin+) creates a `team_invitations` row (48h
  token) + a `team_members` row; an **existing** EchoAI account is linked
  immediately (`active`), otherwise `pending` + email with `/?invite=<token>`.
  `POST /accept` (auth only): **looks up the token first, verifies the caller's
  email matches `invited_email` BEFORE consuming it** (a wrong-email caller gets
  403 and the token stays valid for the real invitee), then atomically consumes
  it via conditional `UPDATE ... WHERE accepted_at IS NULL AND expires_at > NOW()`
  (single-use; concurrent accept loses the race → 410). Expired/used/invalid → 410.
- **Seats are membership-driven.** `recomputeOwnerSeats(ownerId)` sets
  `users.team_size = 1 (owner) + count(active members)` and calls the exported
  `syncSeatItem` (best-effort try/catch) on accept/remove. Extra seats beyond the
  tier's included count auto-bill `$50` (enterprise unlimited); **no hard block**.
- Migration `models/032_team_members.sql` (`team_role`/`team_member_status` enums;
  `team_members` UNIQUE `(account_owner_user_id, lower(email))` + partial UNIQUE
  on `invited_user_id`; `team_invitations`; idempotent). Client: api.js team
  block; `client/src/sections/team/TeamManagement.jsx` (seat summary + invite +
  members table, owner/admin only) surfaced as Settings **Team** tab (Billing+Team
  gated to owner/admin); onboarding **StepTeam** (step 4, skippable); App.jsx reads
  workspace context + consumes `?invite=` after login; Sidebar shows a role badge.

### Two-way SMS marketing subsystem (`/api/sms`)

- **Pro-gated, brand-scoped, sends over the brand's own Twilio number.** Route
  order is the standard `auth → lockout → featureGate("sms_marketing") →
  denyViewerMutations`, **except** the public `POST /inbound` webhook, which is
  mounted **before** that middleware stack (Twilio cannot send a JWT). Every
  authed route resolves the brand via `getOwnedBrand(userId, brandId)`; the
  per-brand Twilio creds come from `twilio_config` (auth token AES-decrypted).
- **AI agents (Anthropic, real, validated, 502 on upstream error).**
  `prompts/smsMarketingPrompt.js`: `generateSmsVariations` returns **5** distinct
  SMS drafts (rejected if empty/not 5 non-empty strings); `generateSmsAutoReply`
  returns `{ reply, temperature }` for inbound auto-responses (reply must be a
  non-empty string, temperature constrained to the lead enum). Both map upstream
  billing/rate/5xx to **502** via the shared `handleAiError`.
- **Opt-out is global and authoritative.** `utils/smsOptOut.js` canonicalizes via
  `normalizeE164` and reads/writes `sms_opt_outs` (UNIQUE `brand_id+phone`).
  `isOptedOut` is checked at **every** outbound SMS site — campaign send, the
  inbound auto-reply path, **and the three pre-existing senders**
  (`followUpController.deliverTouchpoint` → skip, `appointmentController`
  confirmations → silent return, `feedbackController.dispatchSurvey` → 409). A
  contact who texts **STOP** is opted out everywhere instantly; **START** removes
  the row (also exposed as owner-initiated `POST /resubscribe`). **Regression
  watch:** any new outbound SMS must call `isOptedOut` first.
- **Inbound webhook flow.** `handleInbound` identifies the brand by
  `twilio_config.phone_number = normalizeE164(req.body.To)` (joined to
  `brands`/owner), **validates the Twilio signature** against
  `${getPublicBaseUrl(req)}/api/sms/inbound`, handles STOP/START keywords first,
  else find-or-creates a lead by phone (app-level dedup), records the inbound
  message, generates an AI reply, returns it as TwiML `MessagingResponse`, and
  bumps the conversation `reply_count`. On a non-hot→hot temperature transition it
  fires the **dual-channel hot-lead alert** (email + web push + mobile push). The
  webhook always returns 200 (TwiML) even on internal error, matching the phone
  agent convention.
- **Persistence & concurrency.** `createCampaign` queues per-recipient
  `sms_messages` rows inside a `db.getClient()` transaction; `sendCampaign`
  delivers and tracks `recipient/delivered/reply` counts. `direction` is an enum
  (`inbound`/`outbound`). Migration `models/035_sms_marketing.sql`
  (`sms_campaigns`, `sms_messages`, `sms_opt_outs`; idempotent `IF NOT EXISTS`).
- **Client.** `client/src/sections/SmsMarketing.jsx` — four tabs (Campaigns w/
  AI-assisted builder, Conversations live thread + manual reply, Contacts w/
  re-subscribe, Analytics). `api.js` SMS block; `lib/tiers.js`
  `SECTION_GATES`/`SECTION_TIERS` `sms:"pro"`; Sidebar marketing nav item +
  `NavIcon` `sms` case; App.jsx gates the section.
