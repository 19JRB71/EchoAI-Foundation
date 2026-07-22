---
name: EchoAI exposed 5xx messages
description: err.expose=true lets deliberately user-written 5xx messages through prod masking; used for save-step config faults.
---

- The global error handler masks 5xx messages in production UNLESS the thrower sets `err.expose = true`. Use it only for messages deliberately written for the user (no internals).
- **Why:** a config fault after a successful external step (e.g. mailbox login OK, then encryption/DB save fails) otherwise surfaces as a blank "Internal server error" that can't be diagnosed on Railway without log access.
- **How to apply:** classify known server-side config faults at the throw site (bad ENCRYPTION_KEY format; Postgres 42P01/42P10 = migrations not applied on that DB) with an honest message + `statusCode 500` + `expose = true`, and log a tagged console.error.
- Diagnosis pattern for "Internal server error" on a flow that validates external creds first: if the 4xx path works locally, the fault is AFTER validation — encrypt/persist — not the external service.
