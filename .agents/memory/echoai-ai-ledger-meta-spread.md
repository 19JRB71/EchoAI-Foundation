---
name: EchoAI AI ledger meta spread order
description: When building ai_usage_log entries from assertAiAllowed's resolved meta, spread meta FIRST — its null fields clobber explicit values otherwise.
---

The rule: in any paid-provider wrapper (Anthropic/Hermes/OpenAI, future ElevenLabs), build the ledger entry as `{ ...meta, provider, model, feature, taskType: meta.taskType || fallback, ... }` — meta spread first, explicit fields after.

**Why:** `assertAiAllowed`/`resolveMeta` returns EVERY meta key (taskType, agent, conversationId…) defaulted to `null` when no ambient context exists. Spreading `...meta` last silently nulls explicit fields — the OpenAI TTS wrapper shipped rows with `task_type = NULL`, caught only because a test queried by task_type.

**How to apply:** whenever adding a new gated provider wrapper or extending an existing one, put the meta spread first and prefer `meta.x || explicit` for fields the ambient scheduler context may legitimately override.
