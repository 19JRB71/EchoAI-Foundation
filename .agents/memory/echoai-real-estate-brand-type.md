---
name: EchoAI real-estate brand type
description: Adding a brand-type vertical (real_estate) — the mirror-the-political-pattern recipe + automation dedup seams
---

Adding a new brand-type vertical (real_estate joined political) touches a fixed checklist:
migration + goals config (server `config/goals.js` AND client `lib/goals.js` mirror), Setup Agent
triage + interview + profile save (both controller sites), a `*ContextBlock(brand)` util injected
into every AI prompt builder, a CRM route group (getOwnedBrand + 403 on wrong brand_type), scheduler
crons, echoBriefing gather+template, and 3-place client gating (canOpenSection, departments card,
SECTION_GATES) — plus sw.js CACHE bump.

**Automation dedup rules learned in review:**
- Dedup that does SELECT-then-INSERT is a double-act bug under overlapping ticks. For rows with no
  natural unique key (e.g. `ad_creatives`), claim by inserting a placeholder row inside a short
  transaction under `pg_advisory_xact_lock(hashtextextended(key,0))`, run AI outside, then UPDATE
  it; DELETE the placeholder on AI failure so a later run retries.
- Auto content posts must dedup against THEIR OWN output only: `social_posts.source` slot key
  (`re_auto:<date>:<slot>`, NULL for manual posts) + partial unique index (brand_id, platform,
  source) + `ON CONFLICT DO NOTHING`. Deduping on "any recent post" silently kills the cadence
  whenever the owner posts manually.

**Why:** the architect review failed the first pass on exactly these two seams.
**How to apply:** any new recurring generator in EchoAI — check the claim is atomic and the dedup
key is source-scoped before shipping.
