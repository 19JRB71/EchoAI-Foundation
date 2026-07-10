---
name: EchoAI SSRF IPv6-mapped bypass
description: Private-host allowlists that only check IPv4 + IPv6 prefixes miss IPv4-mapped/compat IPv6 forms.
---

Any owner-supplied-URL validator that blocks private/loopback hosts must also
reject IPv4-mapped and IPv4-compatible IPv6 literals, or a loopback/private
target slips through as a "valid" IPv6 host.

**Why:** `net.isIPv6("::ffff:127.0.0.1")` is `true`, but prefix checks for
`::1` / `fe80` / `fc` / `fd` don't match it, so it passed the block. Forms to
cover: dotted mapped (`::ffff:127.0.0.1`), hex-tail mapped (`::ffff:7f00:1`),
and deprecated compat (`::127.0.0.1`).

**How to apply:** In the IPv6 branch, extract any embedded IPv4 (regex for the
`::(ffff:)?` prefix + dotted or two hex groups → dotted quad) and run it through
the existing `isPrivateIpv4()` range check. See
`EchoAI/utils/competitorSiteUrl.js` `embeddedIpv4()`. Same pattern applies to
web-push / image-save SSRF allowlists if they ever accept IP literals.
