---
name: EchoAI Google review reply identifier
description: Why fetched Google reviews must store the full v4 resource path, not the short reviewId.
---

# EchoAI Google Business Profile review replies

To post a reply to a Google review you call
`PUT /v4/{name}/reply` where `{name}` is the **full resource path**
`accounts/<acct>/locations/<loc>/reviews/<id>`.

**Rule:** when persisting fetched Google reviews, store that full path in
`reviews.external_id` (prefer the list item's `name`; if absent, construct it
from the account + location + `reviewId`). Do NOT store the bare `reviewId`.

**Why:** the reply endpoint can't target a bare id, so storing only `reviewId`
makes every fetched Google review un-replyable via API — it silently falls back
to "manual post" even though Google auto-posting is supported.

**How to apply:** any code that maps GBP review payloads → DB rows must keep the
resource path intact for the reply call.
