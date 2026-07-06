---
name: EchoAI section deep links
description: How push notifications deep-link into a dashboard section via /dashboard?section=<id>
---

# Section deep links (`/dashboard?section=<id>`)

The SPA consumes a one-shot `?section=` query param after login: it strips the
param immediately (no re-navigation on refresh) and only honors ids that are
BOTH in the client `SECTION_TIERS` map AND pass `canOpenSection` (role gating).
Anything else is ignored — never set an unknown section id or the content area
goes blank.

**Why:** push notifications (hot leads, failed posts) need to land the owner on
the exact section with one tap; a raw `setSection(param)` with an unvalidated
id recreates the blank-dashboard class of bug.

**How to apply:** any new server-side alert can deep-link with
`url: "/dashboard?section=<known-section-id>"` (section ids per
`client/src/lib/tiers.js` SECTION_TIERS, e.g. `social`, `email`, `sms`) — no
client change needed. If you add a new section, it becomes deep-linkable once
it's in SECTION_TIERS.

Related: owner failure alerts (failed social posts) follow the hot-lead
pattern — web push + FCM mirror, best-effort, demo brands skipped, alert only
where the atomic `... -> failed` UPDATE actually hit a row (row-count branch),
per-item notification `tag` for browser-level dedup.
