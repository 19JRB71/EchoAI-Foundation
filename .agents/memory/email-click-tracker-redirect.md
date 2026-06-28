---
name: Email click-tracker redirect safety
description: Click/redirect tracking endpoints must not take a raw destination URL — encrypt it so the endpoint can't be an open redirector.
---

# Email click-tracker redirect safety

A public click-tracking endpoint that 302-redirects to a URL taken straight from
a query param (`?url=https://...`) is an **open redirect** — anyone can craft a
link on your trusted domain that bounces to a phishing site.

**Rule:** the destination URL must be encoded by the server when the email is
built, not supplied freely by the caller. In EchoAI the tracker rewrites links to
`?u=<AES-GCM encrypt(url)>` (reuse `utils/encryption.js`) and the public endpoint
decrypts + re-validates `http(s)` before redirecting. A bogus/raw token → 400.

**Why:** GCM is tamper-evident, so only URLs we authored decrypt successfully;
the endpoint can never redirect to an attacker-chosen target.

**How to apply:** any new outbound-link tracker (email, SMS, push) must follow the
same encrypt-the-target pattern — never trust a plaintext redirect target from a
public endpoint.
