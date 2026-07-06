---
name: EchoAI credential-failure detection
description: Client-side regex classifying failed-post reasons as auth/credential problems; must stay in sync with server error strings; Reconnect works even for "connected" accounts.
---

# EchoAI credential-failure detection (social posts)

Failed social posts store the raw error string in `engagement_metrics.error`.
The client classifies credential/auth failures with a message regex
(`isCredentialFailure` in `client/src/sections/social/postFailure.js`) to offer
a "Reconnect account" shortcut next to Reschedule.

**Rules:**
- The regex matches the exact messages the publish path emits: platform API
  auth errors from socialApi's `httpJson` ("401 …", "…access token…"),
  `requireFields` ("Missing credentials…"), and `loadConnectedAccount`
  ("No connected <platform> account"). If those server-side messages are ever
  reworded, update the regex in lockstep (same pattern as the interrupted-
  publish marker text).
- Interrupted publishes ("may or may not have gone out") are explicitly
  excluded — they're a double-post risk, not a credentials problem.
- Connected accounts keep a "Reconnect" button in ConnectedAccounts even while
  status is 'connected': an expired token doesn't flip the row, and the server
  `connectSocialAccount` upserts on (brand_id, platform), so re-entering
  credentials just works. Don't "simplify" back to connect-only-when-missing.
- Reconnect navigation stays inside SocialMedia (tab switch via `openReconnect`
  → ConnectedAccounts `focusPlatform`), since both calendar views are always
  mounted under SocialMedia (sections "social" and "contentcalendar").

**Why:** rescheduling a credential-failed post just fails again; the shortcut
turns a dead end into a fix, but only if the classifier keeps recognizing the
real error strings.
