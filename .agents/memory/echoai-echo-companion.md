---
name: EchoAI Echo companion
description: How the persistent Echo companion panel drives post-setup activation by reusing feature controllers in-process.
---

# Echo companion (post-setup activation + ongoing mode)

Echo is a persistent dashboard panel (`/api/echo`, `client/src/companion/`) that,
after setup, walks the OWNER through activating their marketing: welcome →
connect Facebook (OAuth hand-off) → preview+approve first ad campaign →
preview+approve content calendar → ongoing mode (chat, voice, daily briefing).

**Reuse pattern (do not re-invent):** Echo executes real work through the SAME
synthetic-req/res `invoke(controllerFn, userId, {body})` + `ensureOk` pattern the
Setup Agent uses. Approving a preview launches a real campaign / activates a real
calendar — nothing is mocked.

**Invariant — never block the journey.** A single failed activation step (build
throw OR approve-exec throw) is recorded as skipped with a friendly message and
the flow continues. Same rule the Setup Agent follows.

**Facebook connection step must NOT self-complete while unconnected.** It stays
`needs_connection` and re-runs on each advance; only when `api_integrations` shows
facebook connected does it return an info result that marks it complete. The
client resumes the loop by detecting `?fb=connected` on mount (FB callback
redirects to `/dashboard?fb=connected|error`).

**Owner-only, both sides.** Routes are `auth → lockout → requireOwner`. The client
panel MUST also be gated (`!isTeamMember`) — mounting it for team members would
guarantee 403s and a broken UI.

**Auto-open rule:** open whenever `activationStatus !== "active"` (not just when the
message log is empty), so Echo keeps guiding until fully live; only drive the
advance loop forward when nothing is already awaiting approval.

**Why:** the product promise is "user signs up → Echo takes them live end-to-end
with one-click approvals," so the activation flow, the never-block guarantee, and
the owner-only gating are the load-bearing pieces.
