---
name: EchoAI geo targeting & exclusion zones
description: Per-brand geo_targeting JSONB — hard-exclusion invariants across FB ads, prompts, and lead flagging
---

Per-brand `brands.geo_targeting` JSONB `{areas, exclusions}`; util `utils/geoTargeting.js` is the single chokepoint (normalize, summary, prompt block, FB payload, lead classify, text scan).

- **Exclusions are HARD blocks everywhere.** FB targeting: states/zips map to static FB keys; city/county exclusions can't be FB-keyed, so fail closed by excluding the whole state at the FB level UNLESS the brand also targets an area inside that same state (then content/lead-handling compensates — never wipe the legitimate service area).
- **Why:** legal/compliance exclusions (Sage auto-adds them) must never leak into ad delivery; over-blocking is acceptable, under-blocking is not.
- **How to apply:** any new outbound channel (new ad platform, new content generator, new lead intake) must wire geoContextBlock into its prompt AND classify/flag inbound leads via utils/leadGeoFlag.js. Setup-agent brand reads must keep the `AND user_id` ownership join even when a session row supplies brand_id.
