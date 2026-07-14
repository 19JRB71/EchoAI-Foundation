---
name: EchoAI NAVIGATE marker
description: How Echo's chat path performs real dashboard navigation truthfully
---

Rule: Echo may only CLAIM to take the owner somewhere when the reply carries a
valid `[[NAVIGATE: target]]` marker; the server validates the target against a
controller-side allowlist that mirrors the client `NAV_TARGETS` keys, strips the
marker, and returns `message.navigateTo`; the client dispatches
`echoai:navigate-section` (App.jsx re-gates by tier). An UNKNOWN target must
replace the entire reply with an honest fallback — stripping the marker but
keeping "taking you there" text re-creates the original lie.

**Why:** The prompt used to tell Claude to "respond as if taking them there"
while the server chat path had no navigation ability — the local voice regex
was the only real navigator, so any request that fell through to the AI said
"Taking you to Atlas now" and nothing happened.

**How to apply:** Any new spoken/typed action Echo claims to perform must be
backed by a marker (or client intent) that actually executes it, with the
claim suppressed when execution can't happen. Keep the server allowlist and
client NAV_TARGETS keys in sync when adding sections.
