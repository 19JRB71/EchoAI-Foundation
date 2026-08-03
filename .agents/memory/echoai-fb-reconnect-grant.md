---
name: Facebook reconnect grant behavior
description: What Facebook actually shows on a re-consent and how the stored asset snapshot changes
---

On a revoke-and-reconnect (app removed in FB Business Integrations, then OAuth again with `auth_type=rerequest`), Facebook **re-applies the prior asset grant silently** — the user may only be shown a chooser for asset types needing a decision (e.g. ad accounts) and never see a Page picker or full consent list.

**Why:** observed live on staging (Prompt 002, 2026-07-27): granted-pages snapshot collapsed 19 → 1 (exactly the previously selected Page); `page_ref`/`account_ref` survived; tokens refreshed.

**How to apply:** don't treat a missing consent/asset screen as a failed reconnect — verify via the `api_integrations` row's `updated_at` advance + refs intact. Don't expect the full Pages list after reconnect; the snapshot reflects the (possibly narrowed) grant. Staging can be verified read-only via `STAGING_DATABASE_URL`.
