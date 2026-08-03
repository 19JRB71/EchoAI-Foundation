---
name: EchoAI per-brand ad destination
description: Facebook ad launches resolve Page + link from brand columns, never env vars or user-scoped page_ref
---

Rule: every Facebook ad launch path resolves the Page and destination link ONLY from `brands.facebook_page_id` / `brands.ad_link_url` via the shared `resolveBrandAdDestination` helper (exported by campaignController). It also verifies the Page is still in the owner's granted list (`api_integrations.facebook_pages`) and throws 503 with reconnect guidance if not — BEFORE any Graph call.

**Why:** env vars `FACEBOOK_PAGE_ID`/`FACEBOOK_LINK_URL` and user-scoped `page_ref` were deploy/account-global, breaking multi-brand accounts (one owner, multiple Pages/sites). D-20 Option C locked this per-brand architecture; grep proof of zero env/page_ref reads in launch paths is a standing audit criterion.

**How to apply:**
- Never reintroduce env or `page_ref` reads in launch/gating code; `page_ref` is ONLY a wizard default suggestion.
- New launch-adjacent features (gating, previews, readiness checks) gate on the brand columns + live connection.
- `brands.facebook_page_id` is settable only to a Page in the granted list — both write paths (`selectPage` with brandId, `updateBrand` facebookPageId) validate it; keep any new write path consistent.
- Backfill precedent (migration 127): copy `page_ref` into brands, `website_url` → `ad_link_url`, never overwrite, log row counts.
