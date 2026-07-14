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
