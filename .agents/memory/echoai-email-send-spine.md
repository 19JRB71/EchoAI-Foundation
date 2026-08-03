---
name: EchoAI email-send spine + Approvals Inbox
description: Canonical email_send task-spine adopter rules, Message-ID gate, and the unified Approvals Inbox projection/ratchet design.
---

- ONE canonical adopter: `utils/emailSendSpine.js`. Rule: **an SMTP-accepted message must never be sent twice because bookkeeping failed** — persist-failure after accept = MANUAL_REVIEW, never resend; reconciliation is bookkeeping-only.
- **Why:** email has no idempotent create like FB objects; a resend is customer-visible spam.
- Message-ID gate: zero provider Message-IDs can never reach PROVIDER_ACCEPTED (EXTERNAL_FAILURE `missing_message_id`). EXTERNALLY_VERIFIED is honestly scoped: `verification:'message_id_recorded'` + `deliveryConfirmation:'unavailable'` (no delivery webhooks yet). Proof rows (`send_accept`) carry Message-IDs + counts, NEVER recipient addresses.
- Drip retries resume the SAME task: createTask returns an existing non-terminal row, so RETRY_SCHEDULED → beginSend next tick continues one trail.
- taskSpine legal edge: MANUAL_REVIEW→COMPLETED only for `owner:*` actor WITH meta.resolution (Approvals Inbox / ActivityPanel resolution). System sweeps can never silently complete a review item.
- Approvals Inbox (`/api/approvals`) is projection-only — every read hits the feature tables live; spine vs adapter badging; the adapter inventory is a RETIREMENT RATCHET (count must only decrease as features adopt the spine). Adapter jump targets must be REAL client section ids (autopilot/echogrowth/sage/echoemail).
- **How to apply:** any new email path adopts via emailSendSpine (never its own agent_tasks writes); any new approval queue either lands on the spine or gets an adapter entry + inventory declaration.
- Test gotchas: order agent_task_events by `created_at, event_id` (event_id is a random UUID); stub sendEmail by patching `require('../utils/email').sendEmail` BEFORE requiring controllers (they destructure at load); manual-blast race loser gets 400 not 409.
