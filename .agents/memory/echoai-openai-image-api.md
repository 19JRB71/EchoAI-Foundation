---
name: OpenAI image API mid-2026 change
description: dall-e-3 retired and response_format removed; gpt-image models return inline b64 that must be persisted at generation time
---

**Rule:** All OpenAI image generation uses `gpt-image-1` (via `OPENAI_IMAGE_MODEL`), never `response_format`, and must handle BOTH response shapes: hosted temporary `url` OR inline `b64_json` bytes. b64 responses are persisted to `/uploads/images` at generation time; `persistImage` passes through only strict UUID-shaped `/uploads/images/<uuid>.png` paths (never a generic local-path bypass — the save endpoint takes a client-supplied URL).

**Why:** Mid-2026 OpenAI rejected `response_format` (400 unknown_parameter) and retired dall-e-3 entirely ("model does not exist") — every image feature in prod failed with the generic AI-502 banner. Valid gpt-image sizes are 1024x1024 / 1536x1024 / 1024x1536 (the old 1792 sizes 400).

**How to apply:** Any new image call site goes through `renderFromPrompt`/`generateOne` + `imageUrlFromResponse`; when a prod "AI could not complete" banner appears on image features, probe the real key with a minimal `images.generate` call first — upstream API drift, not app code, has been the cause.
