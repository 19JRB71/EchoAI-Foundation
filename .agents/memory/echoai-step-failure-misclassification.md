---
name: Setup-step failure code vs message mismatch
description: 503 precondition errors classify as provider_unavailable and render the "AI service" template — verify cause via ledgers, never trust the owner-safe copy.
---

The setup agent's step-failure classifier maps ANY 502/503/5xx `statusCode` to `provider_unavailable`, whose owner-facing template says "The AI service was temporarily unavailable." But internal precondition guards (e.g. `resolveBrandAdDestination`: brand missing Facebook Page / ad destination link) deliberately throw with `statusCode 503` — so a configuration/precondition failure renders as an AI outage.

**Why:** Live SDS-H1 verification (Aug 2026) hit this exactly: Step 6 showed the AI-outage message while the AI ledger had zero Anthropic calls; the true cause was the brand having no `facebook_page_id`/`ad_link_url`, recorded verbatim in `agent_tasks.last_error` (status VALIDATION_FAILED).

**How to apply:** When investigating a setup-step failure, never infer the cause from the owner-safe UI message. Check, in order: `agent_tasks.last_error` (ad-launch spine), `ai_usage_log` (was AI even called?), `external_actions`/`external_proofs` (was the provider reached?). Any fix to the classifier must distinguish precondition 503s (actionable-by-owner) from genuine provider outages — likely via an explicit error flag, not status code alone.
