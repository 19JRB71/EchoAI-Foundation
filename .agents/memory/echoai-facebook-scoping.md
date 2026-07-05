---
name: EchoAI Facebook integration scoping
description: Facebook connection (token/account/page) is user-scoped, not brand-scoped, by deliberate design.
---

# EchoAI Facebook integration is user-scoped, not brand-scoped

Facebook connection state (access token, selected ad account, selected page)
lives in `api_integrations` keyed by `(user_id, platform)` with
`ON CONFLICT (user_id, platform)`. All FB read/write paths — OAuth callback,
`select-account`, `select-page`, `verify`, and `adCreativeStudioController`'s
`getFacebookIntegration` / `launchCreative` — resolve by `userId`, never `brandId`.

**Why:** This is the pre-existing architecture across the entire Facebook
subsystem, long before the Setup Wizard. The Setup Wizard (Atlas "Connect
Facebook") follows it: it takes a `brandId` prop for campaign launch context, but
the connection itself is per-user.

**How to apply:** Do NOT "fix" this to be brand-scoped as a side task — an
architect review may flag user-scoping as a defect, but converting every FB
read/write path to `(brand_id, platform)` is a large, risky refactor that is out
of scope for wizard/UX work. Only do it if the user explicitly asks to support
distinct Facebook connections per brand within one account.
