---
name: EchoAI unified Facebook connection (ads + posting)
description: One FB OAuth login serves both Atlas ads and Nova organic Page posting; how page tokens vs brand->Page mapping are stored/resolved.
---

# Unified Facebook connection (Atlas ads + Nova posting)

EchoAI has ONE Facebook OAuth flow that authorizes both ad management (Atlas) and
organic Page posting (Nova). Do not reintroduce a second/separate FB credential
path for posting.

**Storage split (single source of truth for the token):**
- The OAuth callback requests `pages_manage_posts` alongside the ad scopes, then
  fetches `me/accounts?fields=id,name,category,access_token`, builds a
  `pageId -> pageAccessToken` map, encrypts it, and stores it **user-scoped** in
  `api_integrations.facebook_page_tokens` (consistent with FB being user-scoped —
  see `echoai-facebook-scoping.md`). Upsert uses `ON CONFLICT ... COALESCE` so a
  refetch that fails to return tokens never wipes the stored map.
- Per brand, `social_accounts` (platform='facebook') stores **only** `{ pageId }`
  in its encrypted credentials — **never the page token**. The brand→Page mapping
  is just a pointer.

**Resolution at publish time:**
- `resolveFacebookPageToken(brandId, pageId)` joins the brand's owner to
  `api_integrations` and decrypts the live token for that pageId (null if absent).
- `loadConnectedAccount` injects the live page token for FB rows that have a
  `pageId` but no `accessToken`. **Legacy rows that already carry their own
  `accessToken` are used unchanged** — do not break this back-compat branch.

**Why this shape:** the token lives in exactly one place, so a re-consent/refresh
updates every brand at once and no brand row holds a stale copy.

**Rollout gotcha:** existing users must **re-consent once** to grant the new
`pages_manage_posts` scope before posting works; ads keep working meanwhile.
`setFacebookBrandPage` rejects a Page with no captured publish token via
`{ needsReconnect: true }` (400) — the client uses that to prompt a reconnect.

**Out of scope (left as-is):** `campaignController` env `FACEBOOK_PAGE_ID`;
Instagram posting stays manual credential entry.
