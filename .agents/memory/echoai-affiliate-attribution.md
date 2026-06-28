---
name: EchoAI affiliate referral attribution
description: Why referral attribution must complete before the signup token is returned, and how first-payment conversion stays idempotent.
---

# Affiliate referral attribution ordering

When attributing a signup to an affiliate referral, do the attribution INSERT
**before returning the auth token** from register (await it, even though it runs
after the user-creation COMMIT). Do not make it fire-and-forget.

**Why:** commission is earned on the referred user's *first* payment. Conversion
runs from the Stripe `invoice.payment_succeeded` webhook and only matches a
pending, zero-commission `referrals` row. If attribution is fire-and-forget, a
fast first-payment webhook can arrive before the row exists, the conversion
no-ops, and the credit then lands on a *renewal* instead of the first month —
silently violating the "first month only" rule. Awaiting before the token is
returned guarantees the row exists before the user can possibly reach checkout
(they can't pay until logged in).

**How to apply:** keep attribution in a try/catch so a bad/invalid code never
fails an otherwise-successful signup, but `await` it. Conversion itself stays
idempotent + renewal-safe by locking the row `FOR UPDATE` and matching only
`status='pending' AND commission_amount=0`; duplicate webhooks and renewals are
then no-ops. Money math: Stripe amounts are in cents → store dollars as
`round(cents * RATE) / 100` into NUMERIC columns.
