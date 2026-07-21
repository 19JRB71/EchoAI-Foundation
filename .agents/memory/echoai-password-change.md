---
name: EchoAI password change & JWT invalidation
description: Password-change endpoint must invalidate previously issued JWTs and re-issue one for the changing device.
---

**Rule:** Any password-change flow must (1) stamp `users.password_changed_at = NOW()` in the same UPDATE as the new hash, (2) rely on the auth middleware rejecting tokens whose `iat` predates `password_changed_at` (2s grace for second-precision iat), and (3) return a FRESH JWT in the response so the device that changed the password stays logged in — the client stores it in the same place the old token lived (localStorage = remember-me, else sessionStorage).

**Why:** Auth is stateless JWT (30-day tokens). Without the middleware check, a stolen/other-device token stays valid for up to 30 days after a password change, defeating password change as a recovery control. Without the fresh token, the user who changed their password is instantly logged out of their own session.

**How to apply:** Any future flow that rotates credentials (admin reset, forgot-password) must also stamp `password_changed_at` and issue a fresh token where a live session should survive. The middleware check lives in the existing best-effort users lookup in `middleware/auth.js` — no extra query. Change-password always acts on `actualUserId` (team member changes their OWN password, never the workspace owner's).
