---
name: EchoAI provider readiness gate
description: "No green button without a green backend" — server-derived OAuth readiness gating Connect buttons.
---

Rule: OAuth Connect buttons (guided ConnectionsStep + Connections section) are gated by a server `providerReadiness` map returned in guided-setup getState/getChecklist, derived from the SAME `configured()` predicates the OAuth initiate endpoints use (google/facebook/instagram/jobber; email always true). `ready === false` → "Setup required — not configured on this system yet" panel instead of a Connect button; absent map → fail-open (older cached responses).

**Why:** CEO rule (July 2026): never present a clickable action whose backend is known-unconfigured — the click can only produce a confusing 503.

**How to apply:**
- Readiness is keyed by PROVIDER, not checklist item key. Cards that connect through another provider (calendar→google, instagram→facebook) must gate by `meta.oauth || item.key`, or they silently fail open.
- Adding a new OAuth provider: add its predicate to `providerReadiness()` in guidedSetupController AND make sure every client card that uses that provider resolves the right readiness key.
