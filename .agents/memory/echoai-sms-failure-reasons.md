---
name: EchoAI SMS per-message failure reasons
description: How failed SMS sends persist and classify their error so the owner can act before retrying
---

# SMS per-message failure reasons

Failed outbound `sms_messages` rows store `error_message` (TEXT) + `error_permanent`
(BOOLEAN). Set in `deliverQueuedMessages` (smsMarketingController.js) on every
failure path; cleared to NULL on successful send and when `retryCampaign`
re-queues failed rows.

**Permanent vs transient** is decided by `classifySmsError()` against a set of
Twilio error codes (invalid/unreachable/non-mobile number, opted out, bad From).
Permanent = retrying the blast unchanged won't help; the owner must fix the
contact/number first. Everything else is transient (retry is safe).

**Why:** the "Retry Blast" button re-sends failed rows; retrying a blast full of
invalid numbers just fails again. The SmsMarketing.jsx "Why did it fail?" expander
groups failures into fix-first (red) vs safe-to-retry (amber) so owners fix the
cause before retrying.

**Test gotcha:** the SMS db mock in `test/emailSmsFailureAlert.test.js` matches the
failed-status UPDATE by regex — keep it whitespace-tolerant
(`/UPDATE sms_messages\s+SET delivery_status = 'failed'/i`) since that UPDATE is
multi-line.
