# CURRENT_USER_JOURNEY.md

> **Purpose (spec §15).** Map the **actual** experience of a new customer — signup → onboarding → business understanding → account connections → campaign creation → approval → launch → monitoring → reporting. This describes what the code makes happen today, verified against `EchoAI/`. Where behavior is intended-but-not-proven it is labeled. This is the *reviewer's* view of reality, not marketing copy.
>
> Companion detail: see `ONBOARDING_CURRENT_STATE.md` for the file-by-file trace. External-action truth is in `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`.

---

## Stage 0 — Landing & signup

- **Required user actions:** enter email + password (optional team size / referral). — `authController.register` (`EchoAI/controllers/authController.js:76`).
- **System actions:** creates `users` + `subscriptions` in one transaction; issues JWT. In `FREE_TEST_MODE` grants Enterprise with no payment (beta-slot capped).
- **Waiting points:** none material (single request).
- **Failure points:** duplicate email (409); beta capacity (403 → waitlist).
- **Confusing / missing guidance:** the difference between free-test/beta mode and paid signup is driven by an env var (`FREE_TEST_MODE`); a reviewer testing in one environment may see a different flow than another.
- **Time-to-value:** immediate account; no value yet.

## Stage 1 — Entering onboarding

- After signup the client loads `GET /profile`; if `onboardingCompleted` is false it renders the **Guided Setup Wizard** (`App.jsx:967`). Team members skip onboarding entirely (forced complete in `getProfile`).
- **Escape hatch (dead end for value):** the Welcome screen's **"Do this later — take me to my dashboard"** marks onboarding complete with nothing configured. A user can reach the dashboard with no brand, no connections, no data.

## Stage 2 — Choosing a plan

- **Component:** `StepSubscription`. User selects a tier. Stripe payment step is skipped in free test mode.
- **Waiting point:** payment/checkout when not in free mode. *(Billing end-to-end verification is out of scope here.)*
- **Repeated question risk:** none at this step.

## Stage 3 — Business understanding (the interview)

- **Component:** embedded **AI Setup Agent** (`SetupAgent.jsx`) inside the wizard's "profile" step; conversational Q&A powered by real Anthropic.
- **Required user actions:** answer natural-language questions (typed or voice via Whisper fallback).
- **System actions:** builds a `brands` profile (via brand discovery synthesis), captures website/Facebook page, detects political / real-estate brand types, saves working-style preferences.
- **Waiting points:** every question and the final synthesis is a live AI call — noticeable latency; AI failures surface as honest 502 "try again" (never fabricated).
- **Consent gate:** before ANY account configuration runs, the user must explicitly consent (`POST /consent`, enforced by `requireSetupConsent`).
- **Repeated questions:** the brand profile becomes the shared source of truth, so later steps do NOT re-ask business basics. **However**, because the Setup Agent also exists as a standalone surface, a user who bounces between the wizard and a standalone launch can be offered to "continue" an interview twice (overlap noted in KNOWN_ISSUES).
- **Manual setup:** none required beyond answering.
- **Failure points:** AI provider errors (502); brand synthesis parse failure (502) — with an auto-save fallback that preserves answers and offers a retry button.

## Stage 4 — First win (immediate result)

- **Component:** `FirstWinStep`. User picks ONE: publish first post / import first lead / build first ad / write first email.
- **System actions (actual):**
  - Post → AI writes it, **schedules it on the content calendar for tomorrow 10 AM** (NOT published externally yet).
  - Lead → real CRM `leads` row.
  - Ad → AI generates creative **drafts** saved to Ad Studio (NOT launched).
  - Email → AI writes a campaign email **draft** (NOT sent).
- **Dependency:** requires a brand from Stage 3; without it the step routes the user back.
- **Time-to-value:** this is the intended "first success" moment — real in-app artifacts are produced quickly, but the *external* result is deferred to after connection.
- **Failure points:** AI generation errors surface inline; user retries, switches win, or skips.

## Stage 5 — Account connections

- **Component:** `ConnectionsStep`. Cards for Facebook (+Instagram), Google, and Business Email; **states come from live server probes**.
- **Required user actions:** click Connect → OAuth full-page redirect (Facebook/Google) or inline app-password form (email).
- **System actions & honesty safeguards:**
  - "Setup required" when the deployment lacks provider credentials (no dead-end Connect buttons).
  - "Configured but awaiting verification" when creds exist but no OAuth round trip has ever succeeded here.
  - "Can't check right now" when a probe throws (never guessed).
- **Integration dependencies:** Google OAuth **verified on staging 2026-07-23**; Facebook connect **Real but untested on staging**; Instagram rides the Facebook app; email connect self-verifies against the mailbox.
- **Waiting points:** OAuth round trip (leaves the app, returns to same wizard step via persisted `connecting` flag).
- **Failure points:** OAuth failure returns a plain-English banner (raw error logged server-side, never shown); "Help Me" screenshot rescue available.
- **All connections optional / skippable.**

## Stage 6 — Campaign creation

- **Two actual paths:**
  1. **During onboarding**, the Setup Agent's action runner creates a first Facebook ad campaign record and a Google Ads plan (`create_facebook_campaign`, `setup_google_ads`) — tier/opt-in gated, and a failed step is skipped without blocking the run.
  2. **Post-onboarding**, the user creates campaigns in the relevant dashboard sections (Campaigns / Ad Studio / Social / Email).
- **Actual vs. intended:** these steps create **campaign/plan records and creative drafts inside Zorecho**. Whether a real external ad campaign is created/launched on Facebook or Google is **UNVERIFIED end-to-end** — see `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`. Do not treat a created record as proof of a live campaign.

## Stage 7 — Approval

- The onboarding first-win and Setup Agent produce **drafts/scheduled items** that require the user's choice/approval before they would go out (e.g. picking a post variation, saving ad drafts). There is no separate automated approval workflow inside onboarding beyond the explicit consent gate and the user's own selection of drafts.
- **Reviewer note:** the platform's broader approval/publishing workflow (outside onboarding) is documented elsewhere; within the onboarding journey, "approval" is the user selecting/scheduling a draft.

## Stage 8 — Launch

- **Onboarding never launches an external ad or publishes a live post.** First-win posts are scheduled; ads/emails are saved as drafts. Actual external launch/publish happens later in the product and is **Real but untested / UNVERIFIED** at the external boundary (see REAL_ACTIONS doc).
- **Developer intervention required?** Not for onboarding completion. External launch reliability is the open question, not a code gate.

## Stage 9 — Monitoring & reporting

- Onboarding ends at the **"Business Ready" (Done)** screen, which recaps the first win + connected accounts and offers a 2-minute guided tour, then marks `onboarding_completed=true` and (best-effort) sends a welcome email (**UNVERIFIED**).
- Ongoing monitoring/reporting (Mission Control, ROI dashboards, etc.) lives in the main app after onboarding and is covered by the feature-matrix and automation docs, not this journey.
- The Mission Control "Company Setup" checklist (`guidedSetupController.getChecklist`) continues to show live-probed connection status after onboarding, so the user can finish skipped connections later.

---

## Cross-cutting friction / risks the reviewer should note

| Theme | Actual behavior | Impact |
|---|---|---|
| **Dead-end bypass** | "Do this later" completes onboarding with zero config | User can land in an empty dashboard with no brand/connections |
| **Two onboarding surfaces** | Wizard embeds the Setup Agent, which also runs standalone | Possible double "continue interview" prompts; duplicated logic |
| **Three brand-creation paths** | discovery confirm / setup action / `createBrand` | Duplicate-brand risk across surfaces (setup action is guarded; cross-path not) |
| **AI latency** | Every interview turn + generation is a live model call | Perceptible waits; ad generation ~1 min |
| **Deferred external value** | First win = drafts/schedules, not external publish | "Win" is in-app; real external effect happens later and is unproven |
| **External actions unproven** | Ad/campaign/social/email actions create records; external result not verified E2E | See REAL_ACTIONS doc; do not assume launches occur |
| **Provider readiness by deployment** | Connect buttons depend on env-configured creds | Reviewer in dev may see "Setup required" where staging/prod differ |
| **Welcome email** | Best-effort on completion | Delivery UNVERIFIED; onboarding still completes if it fails |

## Time-to-value (honest)

- **Fastest real in-app value:** Stage 4 First Win (a lead row, a scheduled post, or an AI-written draft) — minutes.
- **First *external* value:** deferred until account connection AND the external action pipeline actually fires — **not verified end-to-end** in this review.
