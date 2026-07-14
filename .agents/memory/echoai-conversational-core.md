---
name: EchoAI Conversational Core prototype
description: Flag-gated experimental NL layer for Echo — isolation, read-only v1, per-user scoping rules
---

# Conversational Core (Zorecho) prototype

Rule: the Conversational Core (`utils/conversationalCore.js`, `/api/core-lab`) is
fully isolated behind `ENABLE_CONVERSATIONAL_CORE=false` (default off) plus an
in-memory emergency-disable; `/status` + disable/re-enable stay reachable when
off, everything else 503s (`code: core_disabled`). v1 is strictly READ-ONLY —
sensitive intents (send/publish/delete/book/modify) return `requiresApproval`
previews and are never executed; all data access goes through
`utils/coreLabTools.js` adapters with `brands.user_id` ownership joins.

**Why:** any in-process, cross-request state (flight recorder ring buffer,
session-memory Map) is process-global — an early review found cross-user leaks.
Sessions must be keyed `${userId}:${sessionId}` and recorder reads filtered by
userId. A client-supplied sessionId alone is never a safe key.

**How to apply:** when extending the Core (new tools, v2 write actions), keep
every new tool in the adapter registry (never direct DB from the reasoning
layer), scope any shared in-memory state by userId, and keep write actions
behind explicit approval. The Lab UI mic is an inline webkitSpeechRecognition —
deliberately NOT the main voice engine; don't merge them casually.
