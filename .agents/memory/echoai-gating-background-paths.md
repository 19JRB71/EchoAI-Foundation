---
name: EchoAI tier-gating on background/auto paths
description: Tier-gated features triggered from auto/background flows must enforce the gate themselves, not rely on route middleware.
---

# Tier gating must be enforced on auto/background paths, not just routes

In EchoAI a feature is tier-gated at the HTTP layer with `featureGate("<key>")`
(reads live tier from `subscriptions`, admins bypass). But many subsystems also
*auto-trigger* work from qualification/conversion flows (chatbot, website widget,
phone call-status, scheduler) that do NOT pass through those route middlewares.

**Rule:** any helper that CREATES a gated resource from an auto/background path
must check the brand owner's entitlement itself (owner role `admin` OR
`meetsTier(tier, requiredTier)`), or a non-paying account gets the paid feature
for free. Example: follow-up auto-enrollment (`maybeStartSequenceForLead`) runs
from the chatbot/widget/phone flows and gates internally via a
`brand -> users -> subscriptions` tier lookup before doing any work.

**Why:** code review caught Starter-tier accounts receiving Professional-only
follow-up sequences because the chatbot/widget enrollment path bypassed the
Pro-gated `/api/follow-ups` routes.

**How to apply:** when adding any "auto-do-X-when-a-lead-warms-up / converts /
calls" behavior for a gated subsystem, add the owner-tier check at the top of the
internal helper. The HTTP routes alone are not sufficient coverage.

(See `echoai-ai-call-502-mapping.md` for the companion AI-failure→502 invariant
that also applies to these AI-backed generators.)
