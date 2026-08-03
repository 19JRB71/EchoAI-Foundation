---
name: EchoAI Google data pull proof
description: Lessons from proving a read-only customer Google (GA4) data pull on staging — quota, OAuth Testing mode, stub seams, screenshot auth.
---

- **GBP APIs ship with quota 0.** mybusinessaccountmanagement/mybusinessbusinessinformation return per-minute quota-exceeded on even ONE call for a fresh Google Cloud project; a separate Google Business Profile API access application is required. Don't treat it as transient. GA4 (analyticsadmin + analyticsdata) works immediately once enabled.
- **Google OAuth apps in "Testing" mode expire refresh tokens after 7 days.** Customer connections silently die weekly until the OAuth consent screen is published to Production. **How to apply:** if a stored Google grant is "revoked", check publishing status before debugging code.
- **Proof-endpoint pattern (mirrors the Stripe recorder):** run the app's REAL pull path (extract it into an exported helper), write the evidence row only from the real response, zero rows on any failure/empty result, idempotent by (run_key,provider,action), runKey↔user binding 409. Redact provider *error text* in HTTP responses too (Google errors can embed token-carrying URLs), not just persisted evidence.
- **Stub seam trap:** a handler calling a local function ignores test stubs placed on module.exports — the handler must call `module.exports.<helper>()` for stubbing on the module object to work.
- **Headless authed screenshots of staging:** client JWT localStorage key is `echoai_token` (not `token`); dismiss the "Hey Echo" popup via its "Not now" button; puppeteer-core isn't installed in the repo — npm-install it in a /tmp dir and use nix chromium.
- **Frame:** South Dixie Storage acts as the *customer* whose grant/tokens/GA4 property the pull uses; Zorecho's developer side only owns the Google Cloud project.
