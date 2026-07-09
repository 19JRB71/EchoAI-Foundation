---
name: EchoAI Echo Email Assistant
description: Owner IMAP/SMTP email monitoring + approval-gated sending — safety seams and traps.
---

**Rules:**
- Drafts are approval-gated: sending is an atomic `pending→sending` UPDATE row-count claim. Any new send path must go through that claim — never a pre-read + send.
- Owner-supplied custom IMAP/SMTP hosts must pass `assertPublicMailHost` (dotted public DNS name only — no IP literals/localhost/.local/.internal). Preset providers bypass user input entirely.
- First sweep of a mailbox only stores the UID cursor (imports nothing); UIDVALIDITY change resets the baseline. Never "import everything" on connect — floods alerts/briefings.
- AI triage failure stores the message with category `general` + NULL summary; alerts only fire for urgent/contract/payment via `enqueueOwnerVoiceEvent` — new voice event types must be registered in BOTH `config/echoVoice.js` EVENT_TYPES/defaults and client `lib/voiceSettings.js` EVENT_META, or the toggle is invisible and settings can't opt out.
- Nodemailer transporters need explicit connection/greeting timeouts or a dead SMTP host hangs the request (default timeouts are minutes).

**Why:** Auto-sending email or probing internal hosts from a server with owner credentials is unrecoverable trust damage; these seams were reviewed and test-pinned at build time.

**How to apply:** Anything touching `utils/emailMonitor|emailComposer|emailAccounts` or adding voice alert types. Tests: `tests/echoEmail.test.js`.
