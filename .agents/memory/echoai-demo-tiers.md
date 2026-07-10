---
name: EchoAI three-tier demo accounts
description: Demo mode is now multi-brand (one is_demo brand per tier), not a single demo brand — how tier selection, gating, and seeding work.
---

# EchoAI three-tier demo accounts

Sales Presentation Mode seeds THREE `is_demo` brands (one per tier: starter/pro/
enterprise), all owned by the admin, each tagged `brands.demo_tier`. This replaced
the old single-demo-brand model.

**The durable trap:** any code touching demo must NOT assume one demo brand.
- `demo_config.demo_brand_id` now points to the ACTIVE tier's brand and is NULL in
  "selector mode" (demo active, no tier chosen yet → client shows DemoSelector).
- `demo_config.active_tier` drives which script steps / suggestions / FeatureGate
  tier the presenter sees. Client derives `demoSimTier` from the selected demo
  brand's `demo_tier` and overrides `currentTier` so the EXISTING FeatureGate shows
  higher tiers as locked upgrade teasers — no new gating code.

**Seeding gates child data by TIER_RANK** (reuse config/tiers.js), not by copying
volumes: pro+ unlocks follow-ups/ad-creatives/sales-scripts/reviews/appointments/
content-calendar; enterprise-only competitor-intel/customer-intel/surveys; starter
social limited to fb/ig (no youtube). Volumes scale per tier.

**Re-seed safety:** `seedDemo()` is transactional and deletes ALL demo brands for
the owner first, then re-inserts one per tier — so re-seed never conflicts. A
partial unique index `(user_id, demo_tier) WHERE is_demo AND demo_tier IS NOT NULL`
backstops concurrent double-seeds (one txn rolls back instead of duplicating).

**Why:** the existing `echoai-portfolio-demo-exclusion` rule (exclude is_demo from
real calcs) still holds and matters MORE now — there are three demo brands to
exclude, not one.
