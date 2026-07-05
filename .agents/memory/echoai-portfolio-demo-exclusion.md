---
name: EchoAI portfolio demo exclusion
description: The is_demo exclusion invariant for all multi-business ("Chief of Staff") features.
---

Any feature that spans MORE THAN ONE of an owner's businesses (portfolio dashboard,
unified briefing, cross-business intelligence, health scoring, unified team view,
Echo chat context switching) must exclude the demo/sandbox brand
(`brands.is_demo = true`) at the **data-gathering layer**, before anything reaches
the AI prompt or the UI.

**Why:** The demo brand ("Premier Auto Group") exists so new accounts see a populated
product. If it leaks into a portfolio total, health score, card, or AI report, every
cross-business number becomes wrong and the AI invents cross-business overlaps with a
fake business. Filtering in the UI is fragile — a new caller forgets it.

**How to apply:** Enumerate brands only via a single gated helper (e.g.
`realBrands(userId)` → `WHERE is_demo = false`) or add `AND b.is_demo = false` to
the join. Do the same in scheduler jobs and in the Echo companion's brand resolver.
Team members are account-scoped (no brand_id), so the "unified team view" is the
account-wide roster — there is no per-brand team demo filter to apply.
