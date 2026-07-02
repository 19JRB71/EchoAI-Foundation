---
name: EchoAI blank/white screen triage
description: The two distinct causes of a blank EchoAI dashboard and how to tell them apart.
---

# EchoAI blank/white screen — triage

A blank/white EchoAI screen has two unrelated root causes. Check them in order:

1. **Server/workflow is down.** The preview only renders when the
   `artifacts/api-server: EchoAI` workflow is running on port 8080. If it's
   stopped or the port is stuck, the SPA never loads. Fix: `fuser -k 8080/tcp`
   then restart the workflow. Confirm with `curl -s -o /dev/null -w '%{http_code}'
   localhost:80/dashboard` (must be 200 through the proxy, not :8080 directly).

2. **Client-side React render throw.** If the server serves 200s (check logs for
   `/api/*` 200s, no 500s) but the screen is still blank, a component threw
   during render. There is now a layered `components/ErrorBoundary.jsx`
   (top-level in `main.jsx`, per-section `key={section}` in `App.jsx`, and a
   `silent` one around `TourProvider`) so a single crash shows a recoverable
   card instead of blanking everything. `componentDidCatch` logs the stack to
   the browser console — read that to find the culprit.

**Why:** Multiple "went blank" reports were cause #1 (workflow stopped), which
looks identical to a code bug. Rule out the server first before hunting the
client. The app previously had NO error boundary, so any throw blanked the
whole SPA and hid the real error.

**How to apply:** When debugging a client render crash you can't reproduce
statically, drive it with the Playwright testing skill (log in with
ADMIN_EMAIL/ADMIN_PASSWORD) and capture the console error, rather than reading
files hoping to spot it.
