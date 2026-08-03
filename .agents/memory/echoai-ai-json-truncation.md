---
name: EchoAI AI JSON output truncation
description: multi-item AI JSON generations can overrun max_tokens — intermittent parse/validation failures
---

# AI JSON generation truncation

- Endpoints asking the model for several full structured items (e.g. 5 creative packages) can intermittently overrun `max_tokens`; the truncated response fails JSON parsing OR parses but drops the last item's fields — two different-looking errors, one root cause.
- **Why:** Ad Creative Studio failed the Prompt 005 staging proof with "Failed to parse the AI response as JSON" and "Creative package 5 is missing body copy"; both were `stop_reason === "max_tokens"` at 4096.
- **How to apply:** size `max_tokens` generously for multi-item generations (8192+), and always check `response.stop_reason === "max_tokens"` before parsing — surface it as an honest 502 ("AI response was truncated"), never let it fall through to parse/validation errors. Intermittent parse failures on an AI-JSON endpoint ⇒ suspect truncation first.
