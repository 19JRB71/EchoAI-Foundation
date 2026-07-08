---
name: EchoAI political brand type
description: How the Political Campaign brand type is gated and where its context flows
---

# Political Campaign brand type

- **Rule:** `brands.brand_type === 'political'` is the single switch. Anything
  political-only must be gated in BOTH places: client `canOpenSection("supporters")`
  (checks the selected brand's type) and server-side in the controller's
  `getOwnedBrand` (403 for non-political brands). UI-only gating fails review.
- **Why:** the Voter CRM (`/api/supporters`) exists only for campaigns; other
  brand types must never write to supporters/campaign_events.
- **How to apply:** new political-only features should reuse
  `utils/politicalContext.js` (isPolitical, campaignProfile, ensureDisclaimer,
  campaignContextBlock) — ad copy must carry the "Paid for by" disclaimer both in
  the prompt AND deterministically in code after AI output validation.
- Validation convention upheld here: invalid enum values (supporterType/status)
  are hard 400s, never silently coerced; date strings are checked as real
  calendar dates before hitting a Postgres DATE cast (else 500).
