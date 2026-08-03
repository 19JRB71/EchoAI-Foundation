---
name: EchoAI spending caps & pause/unpause
description: Prompt 015 delivery controls — deny-by-default caps, pending-activation marker, atomic pause/unpause rules
---

- **Deny-by-default:** unpause requires a brand cap row AND the platform cap row (`ad_spend_caps.brand_id IS NULL`, seeded $25/day as DB data — change via UPDATE, never code). Order: no budget → no brand cap → no platform row → brand SUM → platform SUM.
- **Committed sums** (utils/spendCaps) = `live` + `created_paused AND activation_requested_at IS NOT NULL`. Display-layer `spendLimits.getBrandSpend` stays live-only BY DESIGN — do not "align" them.
- **Marker lifecycle (term 7):** `activation_requested_at` set only after Graph accepts activation; cleared on verified live, on pause — INCLUDING a partial pause where the campaign OBJECT paused (architect-found bug: a stale marker inflates committed sums and traps unpause in its already-pending no-op) — and on definitive failure.
- **Atomicity:** unpause ACTIVE ad→adset→campaign LAST, compensating re-pause reverse order on failure; pause campaign FIRST. Audit `result='success'` = Facebook accepted, never verified-live. Denials write audit + make ZERO Graph calls. Idempotent no-ops write nothing.
- **Sole live-writer unchanged:** only `verifyCampaignStatus` flips created_paused⇔live; the control controller never writes `campaigns.status`.
- **Why:** real ad-spend risk; ten binding owner terms (D-22); first real unpause-to-spend deferred to Phase H (D-7).
- **How to apply:** any new pause/unpause/cap surface must route through evaluateUnpause + the audit table; graphRequest puts params in the URL query string (tests must read `u.searchParams`, not opts.body).
