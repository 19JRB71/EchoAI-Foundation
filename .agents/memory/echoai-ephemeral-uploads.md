---
name: EchoAI ephemeral uploads on Railway
description: Production disk is wiped on every deploy — any user-uploaded file kept only on disk silently vanishes; DB must hold the bytes.
---

Rule: on Railway (nixpacks, no volume) the filesystem is ephemeral — **every deploy wipes `uploads/`**. Any user-uploaded asset persisted only as a disk file will vanish while its DB row survives, producing broken thumbnails and silent feature degradation (e.g. Vision reference photos gone → Autopilot honestly downgrades photo-based renders to "AI ORIGINAL" despite prefer_my_media).

**Why:** July 2026 incident — owner had ~20 reference photos uploaded, all files wiped by prior deploys; DB rows remained so the library "looked" populated but every render fell back to AI.

**How to apply:** store upload bytes in a Postgres BYTEA column as the source of truth; treat disk as a self-restoring cache (read disk-first, restore from DB on miss, best-effort recache). Add an HTTP fallback route after `express.static` for direct URL serving. Pre-migration rows whose files are already gone are unrecoverable — surface honestly, owner re-uploads. A boot-time backfill only helps environments where files still exist (dev), never post-wipe prod.

Same failure mode hit Facebook publishing (July 2026): post image URLs 404'd at publish time → FB posted text-only. All three upload surfaces are now DB-backed: vision reference photos (own table), and `/uploads/images` + `/uploads/media` via the generic `stored_files` table with a self-restoring HTTP fallback route. Any NEW upload directory must follow the same pattern from day one.

Note: Express 5 does not support regex route params (`:dir(images|media)` crashes at boot) — allowlist inside the handler and `next()` for unmanaged dirs instead.
