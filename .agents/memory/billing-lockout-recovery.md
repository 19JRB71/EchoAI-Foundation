---
name: Billing routes must bypass the lockout middleware
description: Why EchoAI's billing-management endpoints are auth-only, not lockout-gated
---

# Billing-recovery routes must NOT be lockout-gated

In EchoAI, `middleware/lockout.js` returns **403** for accounts whose
failed-payment grace period has elapsed (`is_locked`). Any route wrapped in
`lockoutCheck` is therefore unreachable by a locked customer.

**Rule:** endpoints a past-due / locked customer needs to *recover* their account
(view plans, change plan, view/update payment method, see invoices & upcoming
charge) must be mounted **auth-only**, never behind `lockoutCheck`. Only
value-delivering business routes (campaigns, content generation, etc.) and
create/cancel-subscription stay lockout-gated.

**Why:** the dashboard shows a global red payment-failed banner whose entire
purpose is to let the user fix their card. If the "update payment method" /
"change plan" endpoints sat behind the lockout check, the banner's button would
403 and the user could never self-recover — a support-ticket trap.

**How to apply:** when adding a new subscription/billing endpoint, ask "does a
locked user need this to pay?" If yes → `router.<m>("/x", authMiddleware, ctrl)`
(no `lockoutCheck`). If it delivers product value → keep `lockoutCheck`.
