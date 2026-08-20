---
name: EchoAI Guided Setup Wizard
description: New-customer front-door wizard (/api/guided-setup) — OAuth param ownership, honest probes, screenshot rescue conventions.
---

# Guided Setup Wizard conventions

- **OAuth return params have ONE owner at a time.** App.jsx's global `?fb=` handler
  is gated on `onboardingCompleted`; during onboarding the Guided Setup wizard
  parses/strips `fb=`/`google=` itself and only applies the result if the saved
  server-side step is `connections`.
  **Why:** two handlers racing on the same query params double-strip and one
  silently loses the result (wizard showed nothing after OAuth return).
  **How to apply:** any new post-OAuth redirect consumer must either gate on
  onboarding state or use a distinct param namespace.
- **Card status comes only from live server probes** (`connected` / `not_connected` /
  `unknown` "Can't check right now") — probe failure → `unknown`, never fabricated.
  Client-persisted flags are a whitelist (`skipped`/`connecting`/`errorKey` ≤64 chars),
  sanitized server-side on save.
- **Persist `{connecting:true}` BEFORE `window.location.href = authUrl`** — the
  redirect kills the page; anything after it never runs.
- **Help-Me screenshot rescue reuses `persistScreenshot`** from the health-monitor
  controller (12 MB scoped parser + LARGE_BODY_SUPPORT_PATHS skip); AI vision output
  is validated (`{screen,nextAction,confidence}`), invalid confidence downgrades to
  "low", missing guidance → aiInvalid → 502; low confidence/502 → honest "unsure"
  phase + support-ticket escalation. Never fabricate guidance.
- Progress route is `PUT /api/guided-setup/progress` (not POST).

## Hidden-tab pause must auto-resume on return (July 2026)
The Setup Agent pauses the server session via beacon on visibilitychange→hidden (tab switch, screenshot tool, notifications all trigger it). Returning to the tab must SILENTLY call the idempotent startSetupSession to flip paused→in_progress before re-arming the guard — otherwise the very next answer/step 409s and the user who never left is dumped on the "Setup paused" panel ("it paused itself, I didn't touch anything").

## Milestone flow: First Win before connections (July 2026)
The wizard is milestone-framed per CUSTOMER_EXPERIENCE_CONSTITUTION.md: profile → firstwin (tier-aware real deliverable BEFORE any account connect) → connections ("Unlock Automation" + embedded email app-password card, Milestone 3) → Business Ready recap (first-win + email row + phone-agent pointer).
**Why:** value must land before OAuth friction (Time to First Success).
**How to apply:** the `firstwin` flag rides the connections jsonb (no migration); DoneScreen iterates CONNECTION_CATALOG (OAuth cards only) — email + first-win rows are rendered separately, so new non-catalog connections need their own recap row. OAuth resume still keys on savedStep==="connections"; don't rename that step key.

## Resume must not replay step intro voice lines (July 2026)
gotoStep speaks the step's first-time intro line ("Now tell me about your business…") on every entry — resuming mid-execution replayed it as if starting over ("Echo started asking about my business like beginning"). Resume path passes { resumed: true } and speaks a short "Picking up right where we left off" line instead.

## Pre-completion Social destination handoff
While onboarding is incomplete, the App gate prevents dashboard sections from mounting. An embedded Setup Agent request for Social → Connected Accounts must therefore open the shared Facebook Page picker inline; it must never be translated into First Win. The inline picker is selection-only and writes Store 2 only after explicit **Use this Page** confirmation.

The Guided Setup progress row is only a projection. A saved `firstwin` pointer may be healed back to the profile/Setup Agent surface only when an active serialized session says `connect_social` is the next unresolved planned step. If session truth is unavailable or does not match, fail closed and keep the saved projection.

**Why:** discarding the destination sent the owner to a later milestone while the real Setup Agent session still required Page selection; weakening the pre-completion gate would expose dashboard surfaces too early.

**How to apply:** preserve the normal Connected Accounts picker behavior, reuse its existing Store-2 writer, and let the Setup Agent's normal execute recheck decide whether setup may advance after the owner confirms a Page.
