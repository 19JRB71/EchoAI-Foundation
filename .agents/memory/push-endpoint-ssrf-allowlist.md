---
name: Web Push endpoints are an SSRF vector — allowlist the host
description: Why client-supplied PushSubscription.endpoint must be host-allowlisted before save and send
---

# A PushSubscription.endpoint is client-supplied → treat it as an SSRF vector

When you store a browser `PushSubscription`, the `endpoint` URL comes from the
client and is later used as an **outbound request target** by
`webpush.sendNotification`. Without restriction, an authenticated user can
register an arbitrary `https://internal-host/...` endpoint and trigger
server-side requests to it (SSRF primitive), especially when a server-side event
(e.g. a hot-lead score) fans out sends.

**Rule:** validate the endpoint against an **https + host-suffix allowlist** of
real browser push services before persisting AND again before sending. Reject on
save (400); on send, skip + prune any endpoint no longer on the list.

Known push-service host suffixes: `.googleapis.com` (Chrome/FCM),
`.push.services.mozilla.com` (Firefox), `.push.apple.com` (Safari/iOS),
`.notify.windows.com` / `.push.microsoft.com` (Edge/WNS).

**Why:** same class of bug the codebase already guards against for saved image
URLs. The architect flagged this as a Fail until fixed.

**How to apply:** keep the allowlist in one place (`config/webpush.js`
`isAllowedPushEndpoint`) and call it in both `saveSubscription` and
`sendPushToUser`. Add a conservative `sendNotification` timeout/TTL too.
