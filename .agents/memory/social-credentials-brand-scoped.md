---
name: Social credentials are brand-scoped
description: Why EchoAI social platform credentials live in social_accounts (brand-scoped), not api_integrations (user-scoped).
---

EchoAI stores connected social platform credentials (encrypted AES-256-GCM) in the
`social_accounts` table keyed by `brand_id`, NOT in the existing `api_integrations`
table.

**Why:** `api_integrations` is user-scoped with a fixed enum (`integration_platform`
= facebook, stripe only) and a `UNIQUE(user_id, platform)` constraint. The social
feature (posts, scheduling) is entirely brand-scoped, and supports 6 platforms
(facebook/instagram/tiktok/linkedin/twitter/youtube via the `social_platform` enum),
so credentials were kept brand-scoped to match the rest of the feature instead of
extending the user-scoped table/enum.

**How to apply:** When adding social-account or social-post logic, scope by
`brand_id` and verify brand ownership against the authenticated user
(`SELECT ... FROM brands WHERE brand_id = $1 AND user_id = $2`). The Facebook *ad*
integration is the separate, user-scoped one in `api_integrations` — don't conflate
the two.

**Publishing constraint:** `utils/socialApi.js` makes real platform API calls. Text
publishing works for facebook/twitter/linkedin; instagram/tiktok/youtube genuinely
require a media/video upload and throw an explicit 422 (no silent fallback). The
every-minute scheduler claims due posts atomically (status -> 'publishing' via
`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`) and marks publishes
without a returned external id as `failed`.
