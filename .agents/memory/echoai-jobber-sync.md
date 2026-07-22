---
name: EchoAI Jobber CRM sync
description: Jobber OAuth integration — lockout gating split, race-safe external clientCreate, untestable GraphQL surface.
---

- Jobber routes split gating deliberately: OAuth initiate/status/disconnect stay lockout-free (connection recovery), but operational data routes (import/schedule/send) MUST carry `lockoutCheck` — a wiring test in `tests/jobber.test.js` pins both lists.
- External side effects need the lock BEFORE the API call: lead→Jobber push holds a per-lead `pg_advisory_xact_lock(hashtextextended('jobber_send:'||lead_id,0))` for the whole clientCreate call and re-reads `leads.jobber_client_id` under the lock. A guarded-UPDATE-only approach prevents duplicate local links but still creates duplicate REMOTE clients.
- **Why:** two concurrent sends (manual button + conversion auto-hook) can both pass a pre-read check; only serializing around the external mutation makes it once-only.
- Jobber GraphQL is untestable without a real developer.getjobber.com app (JOBBER_CLIENT_ID/SECRET); everything degrades to 503/notConnected. Only `clientCreate` is implemented — quotes/jobs finish in Jobber via `jobberWebUri` deep link (minimizes untested schema surface).
