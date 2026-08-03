---
name: Facebook Graph API mid-2026 required create fields
description: Required params for campaign/ad set creation as of mid-2026, the dev-mode app trap, and the error-detail surfacing rule
---

As of mid-2026 the Graph API (v21.0) rejects creates with "Invalid parameter" unless these are explicit:
- Campaign: `is_adset_budget_sharing_enabled: false` (subcode 4834011) — budgets live on our ad sets.
- Ad set: `bid_strategy: "LOWEST_COST_WITHOUT_CAP"` (2490487 — otherwise it demands a bid cap); `targeting_automation: { advantage_audience: 0 }` inside targeting (1870227 — keep 0 so FB never auto-expands past our geo hard blocks); `promoted_object: { page_id }` (1885154).

**Why:** discovered live on staging during the PAUSED-chain launch proof; four consecutive launch failures each named exactly one missing field.

**How to apply:** both launch paths (campaignController + adCreativeStudioController) already set these — keep them in sync if a third launch path ever appears.

Other traps:
- A Meta app in **Development mode** can create campaigns/ad sets/creatives but NOT ads from those creatives (subcode 1885183) — the app must be published Live.
- `utils/facebookApi.js` appends `error_user_title`/`error_user_msg` + code/subcode to Graph error messages. Never reduce errors to FB's generic top-line message — it's undebuggable.
- `FACEBOOK_LINK_URL` env var is a launch prerequisite (fail-fast guard) per environment.
