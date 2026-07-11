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

## Reconnect must re-show asset selection

Facebook shows a quick "already granted" confirm on re-auth, hiding the
granular Page/ad-account pickers — so an owner can never ADD a new Page to an
existing grant. The OAuth dialog URL must send `auth_type=rerequest` so the
asset-selection screens appear on every connect. Harmless on first connects.
**Why:** owner reconnected to share a second business's Page and only got the
ad-account confirm; the new Page never appeared in the picker.

## Page list must be refreshed live, not a connect-time snapshot

The Page picker reads facebook_pages stored at OAuth-callback time; Facebook
pre-selects the previous grant on re-auth, so owners routinely finish a
reconnect WITHOUT adding the new Page — and even when they add it later via
Facebook Settings → Business integrations, a snapshot list never shows it.
GET /api/facebook/accounts now live-refreshes /me/accounts (updates
facebook_pages, merges live page tokens over stored; graph failure falls back
to snapshot). **Why:** owner's second-business Page never appeared despite
reconnecting. **How to apply:** treat any FB asset list shown for user choice
as live data; snapshots only as a fallback.

## Full reset is the reliable fix when a Page won't appear

When reconnects (even with `auth_type=rerequest` + live page refresh) still
never surface a Page, the working fix is a **two-sided reset**:
1. Disconnect in EchoAI (deletes the user's api_integrations facebook row;
   Disconnect buttons live in Settings AND the Connected Accounts Page picker).
2. Remove the app on Facebook: facebook.com/settings/?tab=business_tools →
   remove the app. This is the step that makes Facebook forget the old
   partial Page grant; without it FB keeps skipping the checklist.
3. Reconnect — FB then shows the fresh "Choose the Pages" screen; recommend
   **"Opt in to all current and future Pages"** so new business Pages never
   need this again.
**Why:** FB remembers the original partial selection ("one Page only") across
reconnects; verified fixed for a multi-brand owner this way.
Brand→Page mappings ({pageId} pointers in social_accounts) survive the reset;
tokens come back on reconnect, so brands don't need re-picking unless desired.
