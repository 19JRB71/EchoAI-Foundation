---
name: EchoAI Sage brand isolation
description: Sage intelligence is strictly per-brand; every surfacing path must resolve ONE active brand, never pick across ANY(owned brands).
---

**Rule:** Any feature that surfaces Sage intelligence (readouts, briefings, voice alerts, chat context) must resolve exactly one ACTIVE brand and query by that single `brand_id`. Never use `brand_id = ANY(ownedBrands)` with "most recent wins" — that is exactly how a casino-affiliate report leaked into Blacor Homes.

**Why:** Data-layer queries were already brand-scoped; the leaks lived in DELIVERY paths that aggregated across the owner's whole portfolio (section readouts, morning/weekly briefing sage note, voice alert queue).

**How to apply:**
- Active brand resolution: client-sent brandId → ownership join (non-demo) with UUID-regex guard; fallback `users.last_active_brand_id` (also ownership-joined); if unresolvable → surface NOTHING (never fall back to another brand). Demo brand → client sends `"none"` sentinel so the server holds everything.
- Brand-scoped voice alerts (`payload.brandId`): hold in SQL (`payload->>'brandId' IS NULL OR = $2`) so held rows can't starve the LIMIT; they stay `pending` and deliver after the owner switches brands. Non-brand alerts (no payload.brandId) always deliver.
- Client defense-in-depth: filter at enqueue AND re-validate at speak time in the drain loop; a mismatched item is dropped WITHOUT marking delivered so the server re-serves it later.
