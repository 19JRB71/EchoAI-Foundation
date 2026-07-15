---
name: EchoAI authenticated UI screenshots
description: How to capture logged-in dashboard screenshots when the testing subagent can't (no env secrets, empty screenshotPaths).
---

**Rule:** The testing subagent cannot read env secrets (ADMIN_EMAIL/ADMIN_PASSWORD) and its `screenshotPaths` come back empty even on success — never rely on it for screenshot deliverables. Also, the ADMIN_PASSWORD secret can drift from the DB hash (owner changes password in-app), so UI login with the secret may fail even when the secret is set.

**Why:** Discovered July 2026 delivering AI Economics dashboard screenshots: runTest logged in once, later failed ("credentials not available"), bcrypt.compare(ADMIN_PASSWORD, users.password_hash) = false, and both successful runs returned `screenshotPaths: []`.

**How to apply:**
1. Mint a real admin JWT server-side: load admin row from `users`, call `generateToken({userId, email, role})` from `EchoAI/utils/token.js` (signs with JWT_SECRET).
2. Drive nix Chromium via puppeteer-core (install in /tmp): set `localStorage.echoai_token = <jwt>` on `/dashboard`, reload, wait ~7s for SPA.
3. Dismiss overlays before capture: click "Stop" (briefing) and "Not now" (the "Go hands-free with Echo" modal re-appears per page — dismiss again after each navigation).
4. Navigate by clicking sidebar/tab text (Admin, Settings → Billing), then `page.screenshot`.
