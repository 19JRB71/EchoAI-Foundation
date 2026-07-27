# KNOWN ISSUES AND TECHNICAL DEBT

**Package:** ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24

This document lists known bugs, gotchas, incomplete features, duplicated logic,
dead/dark code, hard-coded assumptions, and structural risks. It is compiled by
mining, and verifying against the current code:

- `EchoAI/BACKLOG.md` (approved-but-unbuilt work)
- `.agents/memory/*.md` lesson files (recorded gotchas — these are past bugs and
  their fixes; each represents a subtlety that can regress)
- Grep of `TODO`/`FIXME`/`HACK` across `EchoAI/**/*.js`
- The Gotchas section of `replit.md`
- Structural observations from the repository tree

**Nothing here is softened.** Where a lesson file records a fixed bug, it is
listed as an ongoing *fragility/regression risk*, not a claim it is currently
broken.

---

## 1. Verified structural issues (found directly in the tree)

### 1.1 Duplicate migration number prefixes — HIGH RISK
The migration runner (`utils/runMigrations.js`) applies `models/*.sql` **in
lexical order**. The following prefixes are used by TWO different files each,
confirmed via directory listing:

| Prefix | Files |
|---|---|
| `054` | `054_demo_suggestions.sql`, `054_facebook_pages.sql` |
| `067` | `067_email_blast_failed_status.sql`, `067_email_failure_alert_cooldown.sql` |
| `068` | `068_api_quota_monitoring.sql`, `068_sms_message_error.sql` |
| `071` | `071_content_calendar_frequencies.sql`, `071_email_recipient_error.sql` |
| `090` | `090_competitor_website_digests.sql`, `090_demo_tiers.sql` |
| `096` | `096_ai_cost_controls.sql`, `096_guided_setup.sql` |

**Risk:** apply order between same-numbered files depends on the full filename
sort, not intent. If one depends on the other, a fresh DB (Railway/prod) could
apply them in an order the author did not test. `schema_migrations` tracks by
filename so both apply, but ordering is fragile. **Reviewer action:** confirm
none of the paired files depend on each other.

### 1.2 Two Mission Control implementations coexist
`client/src/sections/MissionControl.jsx` AND
`client/src/missioncontrol/MissionControlV2.jsx` both exist, each with their own
tests (`MissionControl.*.test.jsx` and `missioncontrol/CoreHero.*.test.jsx`).
This is duplicated UI logic; unclear which is authoritative in the live nav.
**Reviewer action:** confirm which is rendered and whether V1 is dead code.

### 1.3 Duplicate SavedScripts / ScriptGenerator components
`client/src/sections/sales/ScriptGenerator.jsx` + `sales/SavedScripts.jsx` and
`client/src/sections/video/ScriptGenerator.jsx` + `video/SavedScripts.jsx` are
parallel implementations of the same pattern. Intentional per-department split,
but a maintenance-drift risk.

### 1.4 Department Collaboration bus is built but DARK
`utils/collaborationBus.js`, `utils/directiveBus.js`, and migration
`122_collaboration_bus.sql` exist, but per `.agents/memory/echoai-dept-collaboration.md`
the entire Stage-0 bus/registry was **built dark with all `COLLAB_*` flags OFF**;
Stage 1 requires explicit CEO go-ahead. This is shipped-but-inactive code.
**Status: PARTIALLY IMPLEMENTED / disabled.**

### 1.5 Conversational Core is a flag-off prototype
Per `.agents/memory/echoai-conversational-core.md`, the Conversational Core
(`sections/CoreLab.jsx`, `/api/core-lab`, `utils/conversationalCore.js`) is a
**flag-off default, read-only v1 prototype** with in-memory sessions keyed by
userId. Not a production path. **Status: PARTIALLY IMPLEMENTED.**

### 1.6 Mobile app is a scaffold
`EchoAI-Mobile/` is a React Native scaffold (`/api/v2` backend exists) but is not
a shipped product. **Status: PARTIALLY IMPLEMENTED.**

---

## 2. Grep results: TODO / FIXME / HACK
A grep of `TODO|FIXME|HACK|XXX` across `EchoAI/**/*.js` returned **no real
inline debt markers** — the only matches are `XXXXX` inside phone-number masking
format strings (`utils/phone.js`, `controllers/authController.js`). This means
the codebase does not track debt via inline comments; debt lives in
`BACKLOG.md` and the `.agents/memory/` lesson files instead. Absence of TODOs is
NOT evidence of absence of debt.

---

## 3. Hard-coded values / business assumptions (verified in code)

- **Pricing is hard-coded** in `config/plans.js` (Starter $100 / Professional
  $350 / Enterprise $550, extra seat $50). Changing tiers requires a code change,
  not config.
- **Eastern Time fallback** is hard-coded across time-of-day greetings, content
  calendar scheduling, and weekly schedulers when a brand timezone is missing
  (`utils/timeOfDay.js`, `utils/timezone.js`, memory `echoai-time-of-day-greetings.md`,
  `echoai-content-calendar-optimal.md`).
- **`+1` US country-code default** for owner SMS — `normalizeE164` will not add it;
  `users.phone` must already be normalized (memory `echoai-personal-assistant.md`).
- **Brand-type verticals** (`political`, `real_estate`) gate whole subsystems in
  both client and server; adding a vertical touches many files (memory
  `echoai-political-brand-type.md`, `echoai-real-estate-brand-type.md`).
- **Only 4 env vars are boot-critical**; a fresh DB must apply `schema.sql` FIRST
  or migrate crashes (memory `echoai-fresh-db-schema-bootstrap.md`).

---

## 4. Approved-but-unbuilt work (from BACKLOG.md)

`EchoAI/BACKLOG.md` lists CEO-approved AI Economics dashboard enhancements to be
built **after private beta** (do not build yet):
- AI spending trend chart, gross-margin gauge, profit projection, top cost
  driver, biggest-savings insight, most-profitable customer, fastest-growing
  customer.

These are **NOT started** — they are backlog only.

---

## 5. Fragility / regression risks (from recorded lesson files)

Each item below is a subtlety that was hit and fixed before; it is a place the
system is easy to break again. Grouped by theme.

### 5.1 External-action safety (double-post / double-charge)
- **Social publish retry** must retry only explicitly-transient errors; anything
  unclassified fails closed to avoid double-posting (`echoai-publish-retry.md`,
  `echoai-failed-post-reschedule.md`, `echoai-stale-claim-rescue.md`).
- **Stripe seat sync** must run on every subscription mutation or seat billing
  drifts (`echoai-seat-billing-sync.md`).
- **Affiliate attribution** must be awaited before returning the signup token or
  a fast first-payment webhook mis-credits (`echoai-affiliate-attribution.md`).
- **Jobber push** must hold the per-lead advisory lock across the remote create
  or it duplicates remote clients (`echoai-jobber-sync.md`).
- **Idempotent public records** must branch on the atomic UPDATE row count, not a
  stale pre-read (`echoai-idempotent-public-records.md`).

### 5.2 Concurrency / locking
- Setup Agent uses a token-fenced renewable lease; a leased writer must
  status-guard its terminal UPDATEs or a dismissed run resurrects
  (`echoai-setup-agent-orchestration.md`, `echoai-lease-vs-lifecycle.md`).
- Appointment booking + reschedule serialize under a per-brand advisory lock
  (`appointments-booking.md`).
- Sage V2 Phase 6 needs a singleton re-check under lock inside the write tx and
  23505→409 mapping (`echoai-sage-v2-phase6.md`).
- Pooled pg client monkeypatch trap in tests can deadlock silently
  (`echoai-pooled-client-patch.md`).

### 5.3 Data integrity / Postgres
- Route `req.body` values must pass through `utils/jsonb.js` before `::jsonb` or
  Postgres crashes (`echoai-jsonb-writes.md`).
- pg bind arity: bind exactly the placeholders a query uses (`echoai-pg-bind-arity.md`).
- UUID-vs-text single-param 500s unless cast (`echoai-pg-uuid-text-param.md`);
  SQL-string mocks hide this class of bug — **prod-only failures**.
- NUMERIC returns strings; null→0 fabrication trap when persisting optional
  numerics (`echoai-api-quota-monitor.md`).
- Leads dedup is app-code only (no unique index); shared insert paths
  (`echoai-leads-dedup.md`).

### 5.4 Multi-tenant isolation (SECURITY-adjacent)
- Sage delivery must resolve ONE active brand, never ANY(owned brands)
  (`echoai-sage-brand-isolation.md`).
- Active-brand id is authoritative in `App.jsx`; brand-scoped panels must mirror
  it, never own a copy, or cross-brand contamination occurs
  (`echoai-active-brand-source-of-truth.md`).
- Portfolio/multi-business calcs must exclude `is_demo` brands at the data layer
  (`echoai-portfolio-demo-exclusion.md`).
- Facebook connection is user-scoped (not brand-scoped) by design — an easy thing
  to "fix" wrongly (`echoai-facebook-scoping.md`, `echoai-facebook-unified-posting.md`).

### 5.5 Security-specific
- SSRF guards must reject IPv4-mapped/compat IPv6 for push endpoints and custom
  IMAP/SMTP hosts (`echoai-ssrf-ipv6-mapped.md`, `push-endpoint-ssrf-allowlist.md`,
  `echoai-email-assistant.md`).
- Email click-tracker redirect must encrypt the destination or become an open
  redirector (`email-click-tracker-redirect.md`).
- Password change must stamp `password_changed_at` and reject older-iat JWTs
  (`echoai-password-change.md`).
- Public widget CORS must be method-aware, never path-prefix
  (`echoai-public-widget-endpoints.md`).

### 5.6 AI-call robustness / cost
- Every Anthropic/OpenAI call must be wrapped to force 502 (SDK errors lack
  `.status`) and re-validate output at save endpoints
  (`echoai-ai-call-502-mapping.md`, `echoai-ai-timeout-retry.md`).
- Anthropic `web_search` responses can `pause_turn` and must be continued or JSON
  parsing fails (`echoai-anthropic-pause-turn.md`).
- AI-ledger meta spread ordering can clobber explicit values
  (`echoai-ai-ledger-meta-spread.md`).
- Background/auto flows that create tier-gated resources must enforce the gate
  themselves — route `featureGate` alone misses them
  (`echoai-gating-background-paths.md`).

### 5.7 Client / build / caching traps
- **Stale bundle**: shipped client features can appear to "do nothing" when the
  browser/PWA service worker serves an old bundle; `index.html` must stay
  no-cache and `sw.js` CACHE version must bump (`echoai-spa-cache-headers.md`,
  replit.md Gotchas). **This is a recurring user-visible symptom.**
- A new component nobody imports can ship a bad import that vitest passes but the
  vite build fails — always rebuild (`echoai-untested-component-import.md`).
- Committed prebuilt bundle means Railway `VITE_*` vars never reach the client;
  env-dependent config must come from a runtime endpoint
  (`echoai-runtime-client-config.md`).
- Brand-discovery fields can be JSON objects; coerce to text before JSX or React
  error #31 blanks the whole app (`echoai-brand-field-shapes.md`).
- Grid `1fr` clips last column under overflow-hidden at laptop widths
  (`echoai-grid-1fr-clipping.md`).

### 5.8 Voice engine (largest concentration of fragility)
The voice subsystem has ~25 recorded lesson files, indicating it is the most
complex and regression-prone area. Notable risks:
- Stale SpeechRecognition closures freeze state for minutes; must read refs
  (`echoai-voice-stale-recognition-closures.md`).
- Self-echo filtering, barge-in matching, permission-to-speak gating, pending
  yes/no offers, and multi-turn session cleanup each have separate reset paths
  that must all be handled or the engine deadlocks/deaf-windows
  (`echoai-self-echo-filter.md`, `echoai-voice-barge-in.md`,
  `echoai-permission-to-speak.md`, `echoai-voice-pending-offer.md`,
  `echoai-voice-content-session.md`, `echoai-voice-client-delivery.md`,
  `echoai-voice-engine-hardening.md`).
- ElevenLabs language auto-detect can misfire; language pinned to `en`
  (`echoai-tts-language-pin.md`). TTS falls back ElevenLabs→OpenAI except in
  strict Presentation Mode (`echoai-tts-provider-fallback.md`).
- Audio autoplay requires a warm `<audio>` unlocked on a user gesture; zero-gesture
  reloads cannot autoplay (`echoai-audio-autoplay-unlock.md`).
- **Mic is blocked in the preview iframe** — voice cannot be tested in the Replit
  preview; requires a real browser tab (`echoai-voice-feature.md`).

### 5.9 Scheduler dependence
Several features depend on background schedulers firing (weekly reports,
Autopilot Monday study, goal snapshots, content publish cron, health sweep,
email/SMS failure alerts, connection re-verify). See
`AUTOMATION_AND_BACKGROUND_JOBS.md`. Silent-failure risk if a sweep throws
mid-iteration — mitigated by per-iteration guards (`echoai-sweep-guard-seam.md`),
but this is a systemic reliability dependency.

---

## 6. Ephemeral storage risk (deployment)
Railway wipes `uploads/` on every deploy. Uploaded files must live in a Postgres
BYTEA column (`113_stored_files.sql`, `112_vision_image_data.sql`) with disk as a
self-restoring cache (`echoai-ephemeral-uploads.md`). Any code path that assumes
`uploads/` persists across deploys is a latent data-loss bug.

---

## 7. Testing gaps (summary — see TESTING_CURRENT_STATE.md)
- **No end-to-end tests against live integrations.** All external actions (FB,
  Twilio, Stripe live, SMTP/IMAP, Google, ElevenLabs, OpenAI images, Jobber,
  web-push) are either stubbed or untested end-to-end.
- AI calls are stubbed deterministically in tests (`setupAgent.e2e.test.js`) — good
  for logic, but means prompt-quality and real-model behavior are unverified by
  the suite.
- Voice engine relies on real browser APIs (SpeechRecognition, audio autoplay)
  that unit tests cannot fully exercise.

---

## 8. Naming / consistency observations
- Migration numbering collisions (§1.1) reflect inconsistent numbering discipline.
- Controllers exist with generic names that can collide with existing mounted
  files — edit, never overwrite (`echoai-controller-file-collisions.md`).
- Sage has three phase controllers (`sagePhase4/5/6Controller.js`) plus
  `sageController.js` and `sageBriefingController.js` — a large surface split
  across many files/migrations (`069`, `109`, `116`–`122`).

> **Do not interpret this document as a claim the platform is broken.** It is an
> honest inventory of where the system is fragile, incomplete, dark, or unproven,
> to focus the outside reviewer's attention.
