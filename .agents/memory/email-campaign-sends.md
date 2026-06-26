---
name: Email campaign send idempotency
description: Why EchoAI's email-campaign send path is transactional + has a unique-index backstop, and the route-path collision to avoid.
---

# Email campaign sending — idempotency & route path

## Route path collision
- The AI email-marketing subsystem mounts at **`/api/email-campaigns`**, NOT `/api/email`.
- `/api/email` is already the **admin-only** email-test route (`auth` + `admin`). Reusing it would shadow/clash. Any new email feature must pick a distinct path.

## Sending must be atomic per campaign
**Rule:** the "send next email in the sequence" action must lock the campaign row (`SELECT … FOR UPDATE`) inside a transaction, re-read `current_step`, send, insert send-rows, advance the step, then commit.

**Why:** the campaign tracks progress with a single `current_step` integer (emails sent so far = index of next email). A naive read-then-update lets two concurrent requests both claim the same step → duplicate sends to every lead and a corrupted progress count. Found in code review (architect) on the first cut.

**How to apply:**
- Advance `current_step` **only if ≥1 email actually sent**. A total SMTP outage must ROLLBACK and return 502 so a step is never silently consumed.
- DB-level backstop: unique index `(campaign_id, email_address, sequence_step)` on `email_sends` + `INSERT … ON CONFLICT DO NOTHING`. Belt-and-suspenders with the row lock; also makes retries safe.
- Same `FOR UPDATE SKIP LOCKED`/claim pattern is used by the social-posts cron — keep send-style "claim a unit of work" paths lock-guarded across this codebase.

## AI output validation
- Both the generate and save paths run the LLM/email array through a validate+normalize step (length 3–10, each item must have non-empty subject+body; missing sendTiming defaults to `Day N`) before it can be persisted or sent — so malformed model output never reaches the DB or SMTP.
