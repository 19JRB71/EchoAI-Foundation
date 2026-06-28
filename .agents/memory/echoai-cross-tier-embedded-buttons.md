---
name: EchoAI cross-tier embedded feature buttons
description: When a higher-tier feature's entry point lives inside a lower-tier section, gate the button client-side too — backend 403 alone looks broken.
---

# Cross-tier embedded feature buttons

When a Pro/Enterprise-gated feature is invoked from a button embedded inside a
section that lower tiers CAN access (e.g. a "Generate Image" button in the
Social content generator, where Social is Starter-accessible but image
generation is Pro), the backend featureGate correctly returns 403 — but a
Starter user just sees a broken-looking error.

**Rule:** thread the user's `tier` down to the embedded button and gate it
client-side (hide it or replace it with an upgrade hint) using `meetsTier` from
`client/src/lib/tiers.js`. Do not rely solely on the section-level gate, because
the section is not gated for the lower tier.

**Why:** server gates protect data; client gates protect UX. A 403 that the
user can't avoid clicking reads as a bug, not a paywall.

**How to apply:** App.jsx already computes `currentTier` (admin → "enterprise").
Pass it into the section, then into the child component, and `meetsTier(tier,
"pro")` before rendering the action. Keep the backend gate as the real
enforcement — the client check is only cosmetic.
