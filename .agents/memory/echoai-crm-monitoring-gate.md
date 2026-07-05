---
name: EchoAI CRM role gating — monitoring vs overview
description: Which accountability-CRM read endpoints managers may see vs owner/admin-only.
---

# EchoAI CRM read-endpoint gating

Two *different* read gates in the accountability CRM — don't collapse them onto one guard:

- **Pulse queue overview** (`/api/crm/queue`, `/api/crm/queue/overview`) — manager-visible, read-only. Guard: `denySalesRep`.
- **Sentinel call monitoring** (`/api/crm/calls/today`, `/api/crm/leads/:id/log`, `/api/crm/recording/:id/audio`) — owner/admin ONLY. Guard: `requireRole("admin")` (admin+owner pass, manager+rep 403).

**Why:** monitoring returns sensitive accountability data — full lead contact info (unmasked phone), per-lead logs, Twilio recording playback. It lives in the owner/admin-only Sentinel department. Gating all CRM reads with `denySalesRep` alone leaks this to managers, who are otherwise read-only-everywhere.

**How to apply:** keep the backend guard matching the client gate — `callmonitor` section uses `canOpenSection = isAdmin || !isTeamMember` (owner/platform-admin only). Client gating is UX only; the backend `requireRole("admin")` is the real boundary.
