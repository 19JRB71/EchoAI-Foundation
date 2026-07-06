---
name: EchoAI social publish retry
description: Transient-vs-hard classification for the scheduled-post publisher's automatic retry.
---

# Social publish automatic retry

The every-minute publisher gives a post a second attempt only for **explicitly
transient** errors: `err.transient === true` (set by socialApi on network-level
failures that never reached the platform), HTTP 429, or HTTP >= 500. Everything
else fails immediately — including any error with **no** status/transient
signal.

**Why:** fail-closed on ambiguity. An unclassified error (e.g. "platform did
not return a post id") may have fired AFTER the platform accepted the post, so
retrying risks double-posting. 4xx auth/content rejections can't succeed on
retry and would only delay the owner seeing the reason.

**How to apply:**
- Retry re-queues via `status='scheduled'` + short delay + `publish_attempts`
  counter on `social_posts`, guarded by `AND status='publishing'` so it can't
  clobber a row resolved out-of-band. The stale-'publishing' rescue sweep stays
  fail-only (same double-post reason).
- Manual reschedule (failed→scheduled) resets `publish_attempts = 0`.
- New throw sites in socialApi that are safe to retry must set
  `err.transient = true`; don't loosen the classifier instead.
