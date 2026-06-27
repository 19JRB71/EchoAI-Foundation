---
name: EchoAI public widget endpoints (CORS + abuse)
description: Rules for exposing public, unauthenticated endpoints (embeddable widgets) safely in EchoAI
---

EchoAI's website chatbot is embedded on arbitrary third-party sites, so some
`/api/chatbot/*` endpoints must accept any origin while staying safe.

## Method-aware CORS, not path-prefix CORS
Open CORS only for the exact public surface, gated by **method + path**, never a
bare `startsWith("/config/")`:
- `GET /config/:id`, `POST /chat`, `POST /capture`, and OPTIONS preflight for
  chat/capture → open to any origin, `credentials:false`.
- Owner-only `PUT /config/:id` and `GET /sessions/:id` → standard allowlist.

**Why:** a path-prefix match (`/config/`) also matches the owner-only `PUT`,
exposing a privileged write to any origin. In dev all origins are allowed
regardless, so this only bites in production — curl tests in dev can't see the
difference; verify the gate logic directly.

## Public endpoints invite abuse — gate side effects on real state transitions
Anonymous visitors can replay a public POST freely. Owner notifications
(email/push hot-lead alerts) must fire only on a genuine state transition
(non-hot→hot, comparing the pre-UPDATE value) AND only when a real linked
record (lead with contact info) exists — otherwise a visitor can spam the owner
by posting the same "hot" message repeatedly.
