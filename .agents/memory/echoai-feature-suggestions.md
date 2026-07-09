---
name: EchoAI feature-suggestion capture
description: AI marker contract for capturing unsupported asks from Echo chat, and the confirm-only-on-success honesty rule.
---

The Echo chat prompt has the AI tag unsupported asks with a `[[FEATURE_REQUEST: ...]]` marker that the server strips and logs.

**Why:** two hard-won lessons.
1. Marker instructions phrased softly ("end your reply with this marker") get silently ignored by the model — it mimics the acknowledgment phrasing but drops the marker. The instruction must be labeled CRITICAL/MANDATORY, state that the user never sees the marker, and warn that omitting it discards the request. Then compliance is reliable.
2. The "I've noted that suggestion" confirmation is appended by the SERVER only after the DB write succeeds; the AI is explicitly told never to claim logging itself. A logging failure keeps the warm acknowledgment but drops the claim (honesty rule).

**How to apply:** any future hidden-marker protocol between prompt and server needs the same forceful phrasing + server-side-only confirmation. Also: `config/anthropic` exports `createMessage`/`MODEL` but NOT `extractText` — each caller defines its own extractor; importing it silently yields undefined and only fails at call time inside a catch, so smoke-test the actual logging path, not just the chat reply.
