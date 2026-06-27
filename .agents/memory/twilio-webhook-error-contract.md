---
name: Twilio webhook error contract
description: Voice webhooks must return valid TwiML 200 even on failure; differs from the rest of the API's error mapping.
---

Twilio voice webhooks (`POST /api/phone/inbound`, `POST /api/phone/respond`) must
**always return valid TwiML with HTTP 200, even on internal error**. If a handler
throws/500s mid-call, Twilio drops the live call with a generic failure to the
caller. So those handlers wrap everything in try/catch and emit a spoken fallback
(`<Say>` + `<Hangup>`) instead of propagating the error.

**Why:** this contradicts the rest of EchoAI's convention, where AI/Twilio/Stripe
upstream failures map to **502** and other errors to 4xx/500 JSON. The webhook
handlers are the deliberate exception — the response body is a control protocol
for a phone call, not a status report to a programmatic client.

**How to apply:** any new Twilio (or similar telephony) webhook handler returns
TwiML 200 with a graceful spoken fallback on error. Reserve 502/4xx JSON for the
authenticated JSON routes (config save, outbound initiate, history). The webhooks
are still secured via `validateTwilioRequest` (X-Twilio-Signature), bypassable in
dev only via `TWILIO_SKIP_VALIDATION`.
