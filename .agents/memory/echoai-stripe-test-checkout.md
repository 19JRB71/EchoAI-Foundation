---
name: Stripe test-mode checkout proofs
description: Gotchas for exercising the real subscribe path with Stripe test cards and proving webhooks on staging.
---

- **`pm_card_visa` alias trap:** shared test PM aliases mint a NEW PaymentMethod on EVERY API reference. Passing the alias through a multi-call endpoint (attach → set default → subscribe) fails mid-sequence with "payment method must be attached". **How to apply:** create one concrete PM via `paymentMethods.create({type:'card',card:{token:'tok_visa'}})` and pass its `pm_…` id — exactly what the frontend does.
- **Why:** two staging 500s during Prompt 007 came solely from this; the app code was correct.
- **Webhook secret location:** staging runs on Railway — `STRIPE_WEBHOOK_SECRET` must be a Railway variable; a Replit workspace secret never reaches the deployed app. Genuine verification shows Stripe's "No signatures found matching…" 400; a 400 from "Received undefined" means the key is missing, not that verification works.
- **Preflight before checkout:** the app refuses to subscribe without `STRIPE_PRICE_*` env; assert env price id === live Stripe price id (exact match also catches copy-paste whitespace).
- **I-28 pricing discrepancy (open, documented not fixed):** Stripe Starter $197 vs app-documented $100; no Growth price exists in Stripe though the app has a growth tier.
