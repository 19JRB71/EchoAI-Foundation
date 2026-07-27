# EchoAI Mobile API (v2)

This document describes the **mobile API** that powers the native iOS & Android
apps (`EchoAI-Mobile/`). It is versioned under `/api/v2` and is optimized for
mobile clients: lean payloads, cursor-based pagination, a standard response
envelope, long-lived (30-day) sessions, refresh tokens, and biometric login.

The base URL is the same origin that serves EchoAI (single-origin web + API). In
development that is your Replit dev domain; in production it is your published
domain. All paths below are relative to that origin.

---

## Response envelope

**Every** v2 endpoint returns the same JSON envelope, so the client can parse all
responses uniformly:

```json
{
  "status": "success" | "error",
  "data": <object | array | null>,
  "message": "human-readable string",
  "pagination": {
    "nextCursor": "<opaque string | null>",
    "hasMore": true,
    "limit": 20
  } | null
}
```

- `pagination` is present only on list endpoints; it is `null` everywhere else.
- HTTP status codes are meaningful (200/201 success, 400/401/404/409 client
  errors, 500 server, 502 upstream). On any error, `status` is `"error"`,
  `data` is `null`, and `message` explains what went wrong.

---

## Authentication

The mobile app uses **JWT bearer tokens**. Send the access token on every
protected request:

```
Authorization: Bearer <accessToken>
```

Three token types:

| Token | Lifetime | Purpose |
|---|---|---|
| **Access token** (JWT) | 30 days | Authorizes API requests. Same `{userId,email}` shape & secret as the web token, so it works on all existing routes too. |
| **Refresh token** (opaque) | 90 days | Single-use; exchanged for a new access token when the old one expires. Only its SHA-256 hash is stored server-side. |
| **Biometric token** (JWT) | 5 minutes | Minted while logged in, stored in the device secure enclave, and exchanged (after a local Face ID / fingerprint check) for a fresh session. |

### Recommended client flow

1. **Login / Register** → store `token` + `refreshToken` in secure storage.
2. Immediately call **`POST /api/v2/auth/biometric`** and store the returned
   `biometricToken` in the device secure enclave (Keychain / Keystore) gated by
   Face ID / fingerprint.
3. On app launch:
   - If the access token is still valid → proceed.
   - Else if a refresh token exists → **`POST /api/v2/auth/refresh`**.
   - Else if biometrics are enabled → unlock the enclave, then
     **`POST /api/v2/auth/biometric/login`** with the stored biometric token.
   - Else → show the Login screen.
4. On `401`, try a single refresh; if that also fails, send the user to Login.

> Optional `deviceId` / `deviceName` may be supplied to auth endpoints; they are
> stored with the refresh token so you can identify/revoke individual devices.

---

## Auth endpoints — `/api/v2/auth`

### `POST /register`
Create an account. Body:
```json
{ "email": "a@b.com", "password": "secret", "teamSize": 1, "referralCode": "ABC123", "deviceId": "...", "deviceName": "iPhone 15" }
```
`201` →
```json
{
  "status": "success",
  "message": "Account created",
  "data": {
    "token": "<jwt>",
    "refreshToken": "<opaque>",
    "refreshTokenExpiresAt": "2026-09-26T...Z",
    "expiresIn": "30d",
    "user": { "userId": "...", "email": "a@b.com", "subscriptionTier": "free" }
  },
  "pagination": null
}
```
`409` if the email already exists.

### `POST /login`
Body: `{ "email", "password", "deviceId?", "deviceName?" }`.
`200` → same `data` shape as register. `401` on bad credentials.

### `POST /refresh`
Body: `{ "refreshToken", "deviceId?", "deviceName?" }`.
`200` → `{ "token", "refreshToken", "refreshTokenExpiresAt", "expiresIn" }`.
The refresh token is **rotated** (single-use): the response returns a new refresh
token; the old one is invalidated. `401` if invalid/expired.

### `POST /biometric` *(protected)*
Mints a short-lived biometric token for the current session.
`200` → `{ "biometricToken": "<jwt>", "expiresIn": "5m" }`.

### `POST /biometric/login`
Exchange a biometric token (after the device's local biometric unlock) for a
fresh session. Body: `{ "biometricToken", "deviceId?", "deviceName?" }`.
`200` → same `data` shape as login. `401` if the token is invalid/expired or not
a biometric token.

### `POST /logout` *(protected)*
Revokes refresh tokens. Body `{ "refreshToken" }` revokes just that device; an
empty body revokes **all** of the user's refresh tokens (logout everywhere).
`200` → `{ }` with `message: "Logged out"`.

---

## Push registration — `/api/v2/push`

Push notifications are delivered via **Firebase Cloud Messaging (FCM)**. The
backend pushes on three events: a **lead turns hot**, a **weekly report is
ready**, and a **payment fails**. Sending is gated on the server `FCM_SERVER_KEY`
env var — when unset, registration still succeeds (`pushConfigured: false`) but
no notifications are delivered.

### `POST /register` *(protected)*
Body:
```json
{ "pushToken": "<FCM token>", "platform": "ios" | "android" | "web", "deviceId": "...", "deviceName": "iPhone 15" }
```
`201` → `{ "deviceTokenId": "...", "platform": "ios", "pushConfigured": true }`.

### `DELETE /register` *(protected)*
Body: `{ "pushToken" }`. Removes the token (call on logout / push opt-out).
`200` → `{ }` with `message: "Device unregistered"`.

**Notification payload** the app receives (FCM `data`):
| Event | `data.type` | Extra |
|---|---|---|
| Hot lead (chat/web) | `hot_lead` | `leadId` |
| Hot lead (phone call) | `hot_lead_call` | `callId` |
| Weekly report ready | `weekly_report` | `brandId` |
| Payment failed | `payment_failed` | — |

---

## Data endpoints — `/api/v2`

Lean, mobile-optimized reads for the core screens. All require auth.

### `GET /dashboard/:brandId` *(protected)*
The three key metrics from the latest weekly analytics record.
`200` →
```json
{
  "status": "success",
  "message": "Dashboard metrics",
  "data": {
    "brandId": "...",
    "brandName": "Acme",
    "weekDate": "2026-06-22",
    "metrics": { "totalSpend": 1240.50, "totalLeads": 38, "costPerLead": 32.64 }
  },
  "pagination": null
}
```
`404` if the brand isn't found/owned or has no analytics yet.

### `GET /leads` *(protected)*
Cursor-paginated CRM leads (newest first), lean payload.

Query params:
| Param | Required | Notes |
|---|---|---|
| `brandId` | yes | Brand to list leads for (must be owned by the user). |
| `temperature` | no | Filter: `tire_kicker` \| `warm` \| `hot`. |
| `limit` | no | Page size, default 20, max 100. |
| `cursor` | no | `nextCursor` from the previous page. Omit for the first page. |

`200` →
```json
{
  "status": "success",
  "message": "Leads",
  "data": [
    { "leadId": "...", "name": "Jane", "email": "j@x.com", "phone": "+1...",
      "temperature": "hot", "conversionStatus": "prospect", "createdAt": "2026-06-25T...Z" }
  ],
  "pagination": { "nextCursor": "eyJ...", "hasMore": true, "limit": 20 }
}
```

**Cursor pagination contract.** Request the first page without a `cursor`. If
`pagination.hasMore` is `true`, pass `pagination.nextCursor` as `cursor` on the
next request to fetch the following page. When `hasMore` is `false`,
`nextCursor` is `null` and you've reached the end. Cursors are opaque — don't
parse or construct them on the client.

---

## Error handling notes

- **AI / Stripe upstream failures** surface as `502` (never mocked data).
- **Disabled features** (missing env vars) surface as `503` / "not configured".
- **Rate limiting** applies to all `/api` traffic, including `/api/v2`. Handle
  `429` by backing off.

---

## Versioning

`/api/v2` is additive and independent of the existing `/api` (web) routes. The
30-day mobile access token is interchangeable with the web token, so a mobile
client may also call legacy `/api/*` endpoints when a v2 equivalent doesn't yet
exist.
