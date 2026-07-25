# ONBOARDING_CURRENT_STATE.md

> **Scope & method.** This document traces the ACTUAL onboarding code in `EchoAI/` as of 2026-07-24. Every claim below was verified by reading the responsible files (paths cited inline). Where a step's *external* effect could not be proven end-to-end, it is labeled **UNVERIFIED / Real but untested**. Intended behavior is called out explicitly as "Intended" vs. "Actual".
>
> Evidence context (per review global rules): the automated test suites exist and last ran passing on 2026-07-24 in the Replit dev environment. Live external actions (Facebook publish, Twilio, Stripe charges, email sends) have **not** been verified end-to-end in production. Google OAuth was verified working end-to-end on staging on 2026-07-23; Facebook staging connect is **not yet tested**.

---

## 1. Big picture — two overlapping onboarding systems

Zorecho currently ships **two onboarding surfaces that share the same backend brain**:

| Surface | Entry file | What it is | Status |
|---|---|---|---|
| **Guided Setup Wizard** (front door) | `EchoAI/client/src/onboarding/guided/GuidedSetupWizard.jsx` | The new-account wrapper: Welcome → Plan → Business Profile → First Win → Connect Accounts → Team → Done. Rendered whenever `onboardingCompleted` is false. | **Active** (primary path) |
| **AI Setup Agent** (the interview brain) | `EchoAI/client/src/onboarding/SetupAgent.jsx` (client) + `EchoAI/controllers/setupAgentController.js` (server) | Conversational interview → explicit consent → account-configuration action runner. | **Active** — embedded inside the wizard's "profile" step, and ALSO mountable standalone post-onboarding |

**How they connect (verified in `App.jsx`):**
- `EchoAI/client/src/App.jsx:967` — `if (!onboardingCompleted) return <GuidedSetupWizard onComplete={...} />;`
- `App.jsx:975` — after onboarding, `<SetupAgent>` can still be launched standalone (Echo can auto-launch it for a user whose interview isn't finished).
- Inside the wizard, the "profile" step embeds the Setup Agent: `GuidedSetupWizard.jsx:356` `<SetupAgent embedded doneLabel="Continue setup" .../>`.

**Intended vs. actual:** The wizard is the intended single "front door." In actuality, the Setup Agent is a large, independent subsystem (1,583-line controller) that the wizard embeds; it also runs on its own outside the wizard. There are therefore two ways a user can reach the same interview/action machinery.

---

## 2. Step-by-step: New user signup

### Step 0 — Signup mode probe (public)
- **Route:** `GET /signup-mode` → `authController.signupMode` (`authController.js:29`).
- **What the user sees:** nothing directly; the client uses it to decide whether to skip the Stripe payment step (`FREE_TEST_MODE`) and whether the beta program is at capacity (show waitlist).
- **Data:** returns two booleans `{ freeTestMode, betaFull }`. No secrets exposed.

### Step 1 — Register
- **Route:** `POST /register` → `authController.register` (`authController.js:76`).
- **User enters manually:** email, password, optional `teamSize`, optional `referralCode`, `rememberDevice`.
- **What is saved & where:**
  - `users` row (email, bcrypt `password_hash`, `subscription_tier`, `team_size`, `is_beta`).
  - `subscriptions` row (`subscription_tier`, `billing_cycle='monthly'`, `payment_status='active'`) — **created in one transaction** with the user.
  - Referral attribution (best-effort, after COMMIT) via `attributeSignup` (`utils/referralTracking`).
- **Free test mode / beta:** When `FREE_TEST_MODE=true`, new signups get **Enterprise** tier with no payment, capped by admin beta slot count (`beta_settings`/`countUsedSlots`). Row-locked (`FOR UPDATE`) so two concurrent signups can't grab the last slot.
- **Failure behavior:** duplicate email → 409; beta at capacity → 403 with `waitlistOpen:true` (client shows waitlist). On any error, transaction rolls back.
- **Output:** JWT token + user summary. **Functional / verified by code path**; the transactional user+subscription creation is real.
- **Waitlist:** `POST /waitlist` → `joinWaitlist` (`authController.js:50`) inserts into `beta_waitlist` (idempotent). Always returns the same success message (can't probe which emails exist).

### Step 2 — Client decides which onboarding to show
- After login/register, the client fetches `GET /profile` (`authController.getProfile`, `authController.js:232`), which returns `onboardingCompleted` and `onboardingStep`.
- **Team members never run owner onboarding:** `getProfile` forces `onboardingCompleted:true` for team members (`authController.js:278`). The Setup Agent routes are `requireOwner` server-side (`setupAgentRoutes.js:22`), and the Guided Setup routes are `requireOwner` too (`guidedSetupRoutes.js:27`).
- **Actual:** `onboardingCompleted` is only set to `true` when the wizard calls `PUT /profile/onboarding` with `onboardingCompleted:true` (see Step 8). It is a manual completion flag — nothing external forces it.

---

## 3. The Guided Setup Wizard (front door)

**File:** `EchoAI/client/src/onboarding/guided/GuidedSetupWizard.jsx`
**Server progress store:** `guided_setup_progress` table via `EchoAI/controllers/guidedSetupController.js` (routes in `guidedSetupRoutes.js`).

Wizard steps (`GUIDED_STEPS` in `guidedSetupController.js:83`): `welcome`, `plan`, `profile`, `firstwin`, `connections`, `team`, `done`.

### Progress persistence (verified)
- `GET /api/guided-setup/state` → `getState` returns: saved wizard position + **live connection probes** + provider readiness + provider verification + latest Setup Agent session.
- `PUT /api/guided-setup/progress` → `saveProgress` upserts `current_step` and a **whitelisted** `connections` JSONB (only `skipped`/`connecting`/`errorKey` flags and a `firstwin` `{choice,done,skipped}` record). **Real connection status is intentionally NOT storable — it is always probed live** (`sanitizeConnections`, `guidedSetupController.js:199`).
- Progress is saved after every move, so a full-page OAuth redirect resumes on the same step (`GuidedSetupWizard.jsx:111-115`, `221-235`).

### Step: Welcome
- User sees Echo's greeting (spoken via `useEchoSpeak` when autoplay allowed; text always shown). Options: "Let's get started", "Continue where I left off" (if a saved mid-step exists), or **"Do this later — take me to my dashboard"** (calls `finish()` which marks onboarding complete). — `WelcomeScreen`, `GuidedSetupWizard.jsx:423`.
- **Dead-end / escape hatch:** "Do this later" completes onboarding immediately with nothing configured. This is a real bypass of the entire wizard.

### Step: Plan
- **Component:** `StepSubscription` (`EchoAI/client/src/onboarding/steps/StepSubscription.jsx`).
- User picks a tier. In free test mode the Stripe step is skipped (per `authController.freeTestModeEnabled`). *(Billing verification is out of scope for this doc — see REAL_ACTIONS_VS_SIMULATED_ACTIONS.md.)*

### Step: Business Profile (the AI Setup Agent, embedded)
- **Embeds** `<SetupAgent embedded doneLabel="Continue setup" onClose={→firstwin} onExitToSection={→firstwin} />` (`GuidedSetupWizard.jsx:356`).
- Also shows an `OnlineLinksPanel` (business website / Facebook page capture).
- **This is where the real interview + account configuration happens** — detailed in §4.

### Step: First Win (Milestone 1)
- **Component:** `FirstWinStep` (`EchoAI/client/src/onboarding/guided/FirstWinStep.jsx`).
- **Intent:** deliver a real result before any account is connected. User picks ONE of:
  - **Publish first social post** (`post`, all tiers) — calls `api.generateSocial(...)` then `api.scheduleSocial(...)`. **Actual:** the post is written by AI and **scheduled for tomorrow 10 AM on the content calendar** — it is NOT published to Facebook here (publishing requires the later connection). The celebration copy says so explicitly.
  - **Import first lead** (`lead`, all tiers) — `api.createLead(...)` writes a CRM lead row. Real DB write.
  - **Build first Facebook ad** (`ad`, Pro+) — `api.generateAdCreatives(...)` then `api.saveAdCreative(...)` saves drafts to Ad Studio. **No ad is launched.**
  - **Write first marketing email** (`email`, Pro+) — `api.generateCampaignEmail(...)` writes a campaign email draft. **No email is sent.**
- **Requires a brand:** if `getBrands()` returns none (profile step skipped/failed), the step tells the user to go back and build their profile first, or skip.
- **Failure behavior:** AI errors surface honestly in-line (never mocked); user can retry, pick a different win, or skip.
- **Required?** No — every path has "Skip — I'll do this later".
- **Status:** **Functional (in-app)**; the *external* result (actual FB publish / email send) is deferred, so this step's "win" is an in-platform artifact (draft/schedule/CRM row), not an external action.

### Step: Connect Accounts (Milestones 2 & 3)
- **Component:** `ConnectionsStep` (`EchoAI/client/src/onboarding/guided/ConnectionsStep.jsx`).
- **Cards** come from `CONNECTION_CATALOG` (`connectionCatalog.jsx`) plus an inline **Business Email** card.
- **Card state is driven entirely by LIVE server probes** — never local assumptions:
  - `connected` — probe found a connected integration row.
  - `unknown` — "Can't check right now" (probe threw; honest, never guessed).
  - `Setup required` — server `providerReadiness` says the provider's credentials aren't configured on this deployment ("no green button without a green backend"). No Connect button is shown.
  - `Configured but awaiting verification` — credentials exist but no full OAuth round trip has ever succeeded on this deployment (`providerVerification`, `guidedSetupController.js:56`). Honest "unproven" state.
- **Connect flow:** preview panel → `openAuthUrl(authUrl)` (full-page redirect, or new tab when embedded in an iframe). Before leaving, the client persists a `connecting` flag so the wizard resumes here on return.
- **OAuth return handling** (`GuidedSetupWizard.jsx:118-205`): reads URL params for each catalog provider, strips them, and shows a success or plain-English failure banner. Raw provider error goes to the server log only (`POST /api/guided-setup/connection-error` → `reportConnectionError`), never on screen.
- **Email connect:** inline app-password form → `api.connectEmailAccount(...)` → verified against `email_accounts` probe.
- **Providers in catalog:** Facebook (+ Instagram rides the same Facebook app), Google (calendar/Gmail), and Business Email. Jobber appears in the Mission Control checklist but not the wizard connections step.
- **Every connection is optional and skippable.**
- **Status per provider (from global rules):** Google OAuth **Real, verified on staging 2026-07-23**. Facebook connect **Real but untested on staging**. Email connect verifies itself against the mailbox at connect time.

### Step: Team
- **Component:** `StepTeam` (`EchoAI/client/src/onboarding/steps/StepTeam.jsx`). Optional teammate invitations. Skippable.

### Step: Done ("Business Ready", Milestone 5)
- `DoneScreen` (`GuidedSetupWizard.jsx:498`) recaps the first win + connected accounts, and points at the AI phone agent as the one remaining ability (set up later in the Phone department).
- Offers a two-minute guided tour (`localStorage echoai_tour_autostart`).
- **`finish()`** (`GuidedSetupWizard.jsx:284`) calls `PUT /profile/onboarding { onboardingStep:5, onboardingCompleted:true }` → `authController.updateOnboarding` (`authController.js:409`). On the false→true transition it fires the welcome email best-effort (`emailController.sendWelcomeEmail`) — **email send is UNVERIFIED end-to-end**.

---

## 4. The AI Setup Agent — interview → consent → configuration

**Client:** `EchoAI/client/src/onboarding/SetupAgent.jsx` (phases: loading → interview → consent → running → done).
**Server:** `EchoAI/controllers/setupAgentController.js`, routes `setupAgentRoutes.js` (mounted `/api/setup-agent`, all `requireOwner`).
**Session store:** `setup_sessions` table.

### 4a. Interview
- `POST /api/setup-agent/session` → `initiateSession`: resumes an `in_progress`/`paused` session if one exists (stamps `resumed_at`), else starts fresh — seeds a kickoff turn and calls the AI (`askInterview`) for the first question.
- `POST /api/setup-agent/answer` → `submitAnswer`: records the answer under the current field, asks the AI for the next question or `complete:true`.
- **AI is real Anthropic** (`config/anthropic`, model `MODEL`, system prompt `SETUP_AGENT_SYSTEM_PROMPT` from `prompts/setupAgentPrompt`). Malformed AI output → **502, never guessed** (`upstreamError`).
- On completion, working-style preferences (involvement / daily briefing / instant alerts / detail level) are extracted (`extractWorkingStyle`) and saved best-effort via `echoContext.saveWorkingStyle` (`setupAgentController.js:1135`).
- **Voice input fallback:** `POST /api/setup-agent/transcribe` (multipart audio) → OpenAI Whisper via `voiceController.transcribeAudio`. Failure → 502.
- **Pause safety:** in-app unmount calls `POST /pause`; hard tab-close uses `POST /pause-beacon` (JWT in body, verified without the auth middleware since `sendBeacon` can't set headers).

### 4b. Consent gate
- `POST /api/setup-agent/consent` → `grantConsent` sets `consent_granted=TRUE`. The `/execute` route is behind `requireSetupConsent` middleware — **no account configuration runs without explicit in-app consent**.

### 4c. Account configuration (the action runner)
- `POST /api/setup-agent/execute` → `executeNextAction`: runs the NEXT pending action, called repeatedly by the UI until `allComplete`.
- **Concurrency:** a renewable, token-fenced execution lease (`EXECUTION_LEASE_SECONDS=300`, heartbeat 60s) ensures only one step runs at a time and a crashed step can be reclaimed.
- **Each action is atomic, idempotent (completed steps recorded), and tier-gated** (`isActionAllowed` — gated actions are skipped gracefully for lower tiers; admins bypass).
- **A single failed step never blocks the run** — it is recorded as `skipped` with a friendly message and the run continues (`setupAgentController.js:1354-1374`).

**Ordered actions (`ACTIONS`, verified):**

| Order | Key | Label | Feature gate | What it actually does |
|---|---|---|---|---|
| 1 | `create_brand_profile` | Creating your brand & profile | none (baseline) | Seeds a `brand_discovery_sessions` row from the interview answers, then runs `brandDiscoveryController.discovery` confirm path → synthesizes + saves a `brands` row. Also applies political / real-estate brand type + `applyOnlinePresence` (website/FB page). Crash-replay safe. |
| 2 | `set_availability` | Setting your booking availability | `appointments` | Saves weekday 9–5 availability config for the brand. |
| 3 | `connect_google` | Connecting Google Calendar | none | OAuth handoff (`needs_connection`) — real connect verified on staging. |
| 4 | `content_calendar` | Building your content calendar | `content_calendar` | Generates/schedules content calendar entries. |
| 5 | `ad_creatives` | Generating your first ad creatives | `ad_studio` | Generates ad creative drafts. |
| 6 | `create_facebook_campaign` | Creating your first Facebook ad campaign | none | Creates a campaign record. **External FB launch UNVERIFIED — see REAL_ACTIONS doc.** |
| 7 | `setup_google_ads` | Setting up your Google Ads campaign | none | Builds a Google Ads plan (opt-in only). |
| 8 | `connect_social` | Connecting your social accounts | none | OAuth handoff. |
| 9 | `social_schedule` | Scheduling your social posts | none | Schedules social posts on the calendar. |
| 10 | `email_preferences` | Setting up your email campaigns | `email_marketing` | Configures email campaigns / drip. |
| 11 | `create_survey` | Designing your first customer survey | `feedback` | Creates a survey. |

> **Important intended-vs-actual note:** The action labels ("Creating your first Facebook ad campaign", "Scheduling your social posts") read as external actions. In actuality these create **records/drafts/schedules inside Zorecho**. Whether the downstream external result (a live FB campaign, an auto-published post) actually occurs is documented, with evidence, in `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`. Do NOT treat a completed setup step as proof of an external effect.

### 4d. Lifecycle endpoints
- `POST /pause`, `POST /pause-beacon`, `POST /dismiss` (agent won't auto-relaunch), `POST /reset` (deletes the caller's `setup_sessions` so they can re-experience the new-user flow), `GET /latest` (client decides whether to auto-launch), `GET /answer`/`session` as above.

---

## 5. Brand discovery (standalone + reused by Setup Agent)

**File:** `EchoAI/controllers/brandDiscoveryController.js`, route `POST /api/brands/discovery` (`brandRoutes.js:14`).

- Three-part conversation driven by Anthropic (`BRAND_DISCOVERY_SYSTEM_PROMPT`); profile synthesized to JSON via `BRAND_PROFILE_SYNTHESIS_PROMPT` and saved to `brands` (`saveProfile`).
- **Brand-new auto-save-on-confirm behavior (added 2026-07-24):** The discovery agent appends a hidden `[[PROFILE_CONFIRMED]]` marker to its reply once the user confirms the reflected profile. The controller detects the marker (`PROFILE_CONFIRMED_MARKER`, `brandDiscoveryController.js:13`), strips it from the transcript, and **auto-synthesizes + saves the brand right then** — the user never has to click a save button after Echo says they're all set (`brandDiscoveryController.js:208-252`).
- **Honest failure exception:** if the auto-save fails, the controller does NOT return 502 (that would throw away Echo's already-persisted reply). Instead it returns the reply plus a `saveError` string telling the user to click "Finish & save brand profile" to retry (`brandDiscoveryController.js:237-251`). The explicit confirm path (`confirm:true`) still maps AI failures to 502.
- **Duplicate risk / overlap:** brand creation can happen via (a) the discovery confirm path directly, (b) the Setup Agent's `create_brand_profile` action (which itself calls the discovery confirm path), and (c) `brandController.createBrand`. The Setup Agent action is crash-replay-guarded against duplicates via `discovery_session_id`, but there is no cross-path uniqueness guarantee if a user drives multiple surfaces. **Flagged for reviewer.**

---

## 6. What saves where (summary table)

| Data | Entered where | Saved to (table) | Writer | Shared across departments? |
|---|---|---|---|---|
| Account (email/pw/tier/team) | Register | `users`, `subscriptions` | `authController.register` | Yes (workspace-wide) |
| Onboarding progress flag | Wizard finish | `users.onboarding_completed/step` | `authController.updateOnboarding` | Yes |
| Wizard position + connection flags + first-win record | Wizard moves | `guided_setup_progress` (JSONB, whitelisted) | `guidedSetupController.saveProgress` | Wizard-only |
| Interview transcript/answers/consent | Setup Agent | `setup_sessions` | `setupAgentController` | Feeds brand + working style |
| Brand profile | Interview / discovery | `brands` (+ `brand_discovery_sessions`) | `brandDiscoveryController.saveProfile` | **Yes — brand is the shared business memory** |
| Working style prefs | Interview completion | via `echoContext.saveWorkingStyle` | `setupAgentController` | Yes (Echo surfaces) |
| Website / FB page | Interview / OnlineLinksPanel | `brands.website_url`, `facebook_page_url` | `applyOnlinePresence` | Yes |
| First-win artifacts | First Win step | content calendar / `leads` / ad studio / email drafts | respective controllers via `api.*` | Per-department |
| Connection records | Connections step | `api_integrations`, `google_integrations`, `email_accounts`, `jobber_integrations` | OAuth/email controllers | Yes (probed) |

**Repeated data entry:** The brand profile is the single source of truth reused everywhere, so the interview answers are not re-requested by later steps. However, connection status is re-probed on each state fetch (not stored), and the two onboarding surfaces (wizard vs. standalone Setup Agent) can both drive the interview — a user who used one may see the other offer to "continue."

---

## 7. Onboarding path map (text)

```
Landing / Signup page
   │  GET /signup-mode  (freeTestMode? betaFull?)
   ▼
POST /register ──(dup email→409)──> stays on signup
   │              (beta full→403 + waitlist)
   ▼  JWT issued
GET /profile  →  onboardingCompleted?
   ├── true  ────────────────────────────────► Dashboard (App.jsx)
   └── false ─► GuidedSetupWizard (App.jsx:967)
         │
         ▼
   [welcome] ──"Do this later"──► finish() ──► onboardingCompleted=true ──► Dashboard  (BYPASS)
         │ start / resume
         ▼
   [plan]  StepSubscription  (Stripe step skipped if FREE_TEST_MODE)
         ▼
   [profile]  <SetupAgent embedded>
         │   loading → interview (Anthropic, 502 on bad output)
         │        → consent gate (POST /consent)
         │        → running (POST /execute loop: 11 tier-gated actions;
         │              failed step → skipped, run continues;
         │              OAuth actions → needs_connection handoff)
         │        → done  (onClose → firstwin)
         ▼
   [firstwin]  pick 1: post/lead/ad/email
         │   requires a brand (else → back to profile) ; all skippable
         │   AI errors surface honestly; artifacts are in-app (draft/schedule/CRM)
         ▼
   [connections]  live-probed cards: Facebook(+IG) / Google / Email
         │   Setup required (no creds) | Awaiting verification | Connected | Unknown
         │   OAuth full-page redirect → resume here (connecting flag persisted)
         │   every card skippable ; raw errors → server log only
         ▼
   [team]  StepTeam  (optional invites)
         ▼
   [done]  DoneScreen recap  →  finish()
         │   PUT /profile/onboarding {completed:true}  → welcome email (UNVERIFIED)
         ▼
      Dashboard  (+ optional 2-min tour)
```

**Branches / delays / dead ends:**
- **Dead-end bypass:** "Do this later" at Welcome completes onboarding with nothing set up.
- **Delay points:** every AI call (interview turn, brand synthesis, content/ad/email generation) is a live Anthropic/OpenAI round trip; ad generation warns "~a minute".
- **Dependency:** First Win requires a brand from the profile step; skipping profile forces First Win to send the user back.
- **Provider dependency:** Connect buttons only appear when server `providerReadiness` is true; otherwise "Setup required."
- **Resumability:** wizard position + Setup Agent session both resume after OAuth redirects / tab close.

---

## 8. Failure behavior summary

| Failure | Where | What the user sees | Can they continue? |
|---|---|---|---|
| Duplicate email | register | 409 error | Retry with different email |
| Beta at capacity | register | 403 + waitlist offer | Join waitlist |
| Interview AI error / bad JSON | `askInterview` | 502 "try again shortly" | Retry |
| Brand synthesis parse fail | `synthesizeProfile` | 502 (explicit confirm) | Retry |
| Brand auto-save fail | discovery auto-confirm | reply kept + `saveError` prompt to click "Finish & save" | Yes (reply preserved) |
| First-win generation error | FirstWinStep | inline honest error | Retry / pick another / skip |
| Connection probe error | getState | card shows "Can't check right now" | Yes |
| Provider not configured | providerReadiness | "Setup required", no Connect button | Skip |
| OAuth failure return | wizard load | plain-English banner; raw error → server log | Retry / Help Me / skip |
| Setup action step throws | executeNextAction | step marked "skipped" with message | Yes (run continues) |
| Wizard finish fails | `finish()` | ErrorBanner "Couldn't finish setup" | Retry |
| Welcome email send fail | updateOnboarding | (silent, best-effort) | Yes — onboarding still completes |

---

## 9. Overall status labels

- **Signup / auth / subscription creation:** Functional (real, transactional). *(Billing external verification out of scope.)*
- **Guided Setup Wizard navigation + progress persistence:** Functional (verified in code; progress store is real and whitelisted).
- **AI Setup Agent interview:** Functional — real Anthropic, honest 502s.
- **Setup Agent action runner:** Functional as an *in-platform configurator* (creates records/drafts/schedules). External effects of ad/campaign/social actions: **Real but untested / UNVERIFIED** — see REAL_ACTIONS doc.
- **First Win:** Functional in-app; deferred external publishing by design.
- **Connections:** Google **verified on staging**; Facebook **Real but untested**; Email self-verifying; readiness/verification honesty is a genuine, working safeguard.
- **Two overlapping onboarding surfaces + three brand-creation paths:** noted technical-debt / duplication risk (see KNOWN_ISSUES doc).
