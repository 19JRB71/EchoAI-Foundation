---
name: Image Studio (DALL-E) persistence & SSRF
description: Why generated images are downloaded at save time and how the client-supplied image URL must be locked down.
---

# DALL-E image persistence

DALL-E hosted image URLs are **temporary** (expire in ~1-2h). EchoAI generates
images and shows the temp URL as a live preview, but persists the bytes to disk
**only at save time**: download from the temp URL → write
`EchoAI/uploads/images/<uuid>.png` → store the permanent relative URL
`/uploads/images/<file>` in the `images` table. Files are served by
`app.use("/uploads", express.static(...))` mounted **before** the SPA fallback
in `server.js`.

**Why save-time (not generate-time):** most generated variations are discarded;
downloading every variation would waste disk + bandwidth. Persist only what the
user keeps.

DALL-E 3 only supports `n=1`, so "3 variations" = 3 parallel
`openai.images.generate` calls with different style-direction prompts.

## SSRF guardrail (do not regress)

The save endpoint receives the image URL **from the client**, so the server-side
download is an SSRF sink if it fetches arbitrary URLs. `persistImage` must:
- accept **https only**, host must end with an allowlisted suffix
  (`.blob.core.windows.net`, `.openai.com`, `.oaiusercontent.com` — the hosts
  DALL-E serves from),
- bound the download with an `AbortController` timeout,
- validate `content-type` starts with `image/` and enforce a max byte size
  (declared `content-length` + post-read buffer length).

**Why:** an authenticated user could otherwise make the backend fetch internal
services or huge payloads. **How to apply:** any future "download a
user-supplied URL on the server" path needs the same allowlist + size/time caps.
