# AI_AND_INFRASTRUCTURE_COST_MAP.md

_Zorecho / EchoAI full-system review package — spec §17._
_Prepared 2026-07-24. Verified against current code in `EchoAI/`. All prices below are the code's configured **estimate defaults** (env-overridable) — not billed actuals. No numbers are invented; where actuals are unknown this is stated._

## AI models in use (verified by grep of model ids + config)

| Provider | Model (default) | Config source | Purpose / features |
|---|---|---|---|
| Anthropic (Claude) | `claude-sonnet-4-6` (`ANTHROPIC_MODEL`) | `config/anthropic.js` | The **writing/creating** brain: ad copy, emails, social content, briefings, drip sequences, calendars, Sage reports, most content generation. |
| Nous Research (Hermes) | `nousresearch/hermes-4-70b` (`NOUS_HERMES_MODEL`) | `config/hermes.js` | The **decision/orchestration** brain: routing, intent, orchestration decisions gating voice replies. OpenAI-compatible API via `fetch`. |
| OpenAI | `whisper-1` (`OPENAI_STT_MODEL`) | `config/openai.js` | Speech-to-text (voice input transcription). |
| OpenAI | `tts-1` (`OPENAI_TTS_MODEL`), voice `nova` | `config/openai.js` | Text-to-speech (Echo voice) — fallback/alternate to ElevenLabs. |
| OpenAI | `gpt-image-1` | `config/openai.js` | Image generation (ads, social, image studio). |
| ElevenLabs | `eleven_flash_v2_5` (`ELEVENLABS_MODEL_ID`) | `config/elevenlabs.js` | Primary natural-voice TTS + sound generation. Output `mp3_44100_128`. |

**Architecture note (from `config/hermes.js`):** Hermes = thinking/deciding/routing; Claude = writing/creating. This split is intentional.

## Cost controls (verified)

Every paid provider call passes through **one admission gate** — `utils/aiGate.js` `assertAiAllowed()` — invoked by `config/anthropic.js`, `config/hermes.js`, and `config/openai.js` **before any money is spent**. Order:

1. **Emergency switches** (`config/aiControls.js` `getSwitch`): `AI_ENABLED`, `ANTHROPIC_CONTENT_ENABLED`, `OPENAI_CONTENT_ENABLED`, `BACKGROUND_AI_ENABLED`, `USER_AI_ENABLED`, `DEVELOPMENT_AI_ENABLED`.
2. **Environment policy:** outside production, paid calls are **blocked** unless `DEVELOPMENT_AI_ENABLED` is set (prevents previews/rebuilds from spending credits).
3. **Rate limit** (`utils/aiBudget.js` `checkRateLimit`): `AI_MAX_CALLS_PER_MINUTE` (in-memory, per process; 0 = disabled).
4. **Budgets** (`utils/aiBudget.js` `checkBudget`): hard caps by scope.

Blocked calls throw an honest `503` (`err.aiBlocked`) — **never** mocked output.

### Spending caps (budget scopes, `utils/aiBudget.js`)

Read from `config/aiControls.js` `getNumber(...)` (0 = unlimited/disabled). No default dollar amounts are hard-coded in code — they are admin/env-configured:

- `AI_BUDGET_GLOBAL_DAILY_USD`, `AI_BUDGET_GLOBAL_MONTHLY_USD`
- `AI_BUDGET_DEV_DAILY_USD` (non-production only)
- `AI_BUDGET_BACKGROUND_DAILY_USD` (background-triggered calls)
- `AI_BUDGET_BRAND_DAILY_USD`, `AI_BUDGET_BRAND_MONTHLY_USD` (per-brand)

**Threshold policy:** 50% → info alert; 75% → admin warning; 90% → optional **background** AI blocked (user AI continues); 100% → all paid calls in that scope blocked. Alerts deduped in `ai_budget_alerts` (one per scope + UTC period + level). Budget check **fails OPEN** on a metering read error (logs loudly) so a ledger outage doesn't take features down.

## Token tracking / usage ledger (verified)

`utils/aiUsage.js` writes **one row per paid call** (success or failure) to `ai_usage_log` with: environment, deploy version, provider, model, brand/user/agent, feature, task type, job name, request id, conversation id, triggered_by, input/output/cached tokens, web searches, retry count, duration, success, error category, **estimated_cost_usd**, cache metadata, workflow/parent request ids, unit type/quantity.

- Every `/api` request runs inside an **AI workflow context** (`utils/aiContext.js` `runWithWorkflow`) so all provider calls in a request chain share a `workflow_id` — enabling true per-chain cost attribution (`server.js`).
- `recordUsage` is **fire-and-forget** — never throws, never blocks the AI response.
- Admin summary: `summarizeUsage()` → cost today/month, projected monthly, calls, failures, retried cost, breakdown by provider/feature/brand/trigger+environment, and top-10 most expensive requests. Surfaced in the admin economics dashboard (`client/src/admin/AdminEconomics.jsx`).

### Configured estimate prices (defaults; env-overridable — NOT billed actuals)

Token pricing, USD per 1M tokens (`PRICING` in `utils/aiUsage.js`):

| Provider | input/M | output/M | cached input/M | per web search |
|---|---|---|---|---|
| anthropic | 3.00 | 15.00 | 0.30 | 0.01 |
| hermes | 0.70 | 2.80 | 0 | 0 |
| openai | 2.50 | 10.00 | 1.25 | 0 |

Flat per-unit prices (`UNIT_PRICES`):
- `openai:image` = 0.08 (DALL-E-3 1024×1024 HD-ish; `config/openai.js` `estimateImageCost` refines by size/quality: 0.04 / 0.08 / 0.12)
- `openai:tts_per_1k_chars` = 0.015
- `openai:stt_per_minute` = 0.006 (Whisper minutes estimated from byte size, ~16 kB/s, floored 0.1 min)
- `elevenlabs:tts_per_1k_chars` = 0.15

Communications unit prices (`COMM_UNIT_PRICES`, `recordCommsUsage`) — **estimates**, real reconciliation against provider billing is a later approved phase:
- `twilio:sms_segment` = 0.0079
- `twilio:voice_minute` = 0.014
- `email:send` = 0.0004
- `google_search:search` = 0.005
- `elevenlabs:sound_generation` = 0.08

> **These are the code's estimate constants, used to populate `estimated_cost_usd`. Actual billed amounts come from the providers and are NOT tracked here. Do not treat these as real spend.**

## Retry behavior (cost implications)

- **Anthropic** (`config/anthropic.js`): SDK retry disabled (`maxRetries: 0`); custom wrapper retries only **transient** errors (timeouts, 408/409/429, 5xx, overloaded), exponential backoff capped 8s, `AI_MAX_ATTEMPTS` default 3. Deterministic 4xx (auth/quota) are **not** retried. Retry count recorded in the ledger. Auto-streams when `max_tokens >= 16000`.
- **Hermes** (`config/hermes.js`): `HERMES_MAX_ATTEMPTS` default 2, tighter 15s timeout, same transient-only policy, backoff capped 4s.
- **OpenAI** (`config/openai.js`): paid methods (TTS, STT, images) wrapped by `gated()` — gate + ledger; retries governed by the SDK/caller. Failures record $0 spend but keep the error category.
- Streaming replies (`streamMessage`): a transient failure is retried **only if nothing has been emitted yet** (avoids double-speak / double spend).

## Duplicate / unnecessary calls

- Spend snapshots are cached ~20s (`SPEND_CACHE_TTL_MS`) so budget checks before every call stay cheap.
- The ledger has cache columns (`cache_checked`, `cache_hit`, `cache_miss_reason`) indicating a response-cache concept, but whether a content cache is actively deduping identical generations was **not verified**. (UNKNOWN.)
- No systematic detection of duplicate/unnecessary generation calls was found beyond the budget/rate gate. (Potential cost risk — see `KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`.)

## Background AI usage

- Scheduler-triggered calls set `triggeredBy: "background"` (via `utils/aiContext.js` ambient context) and are subject to the **background daily budget** and the 90%-threshold pause. Background jobs are enumerated in `AUTOMATION_AND_BACKGROUND_JOBS.md`.

## Image / voice / storage / bandwidth

- **Image generation:** `gpt-image-1` via gated `client.images.generate` — cost estimated per image by size/quality.
- **Voice:** ElevenLabs (primary) + OpenAI TTS (fallback) for output; Whisper for input. All gated + ledgered (ElevenLabs comms unit for sound generation; ElevenLabs TTS via `elevenlabs:tts_per_1k_chars`).
- **Storage:** uploaded media under `EchoAI/uploads/` (audio, images, media, support, vision) on the app filesystem/volume. No object-store (S3/GCS) integration was found in server `package.json`. Storage/bandwidth **costs are not tracked in code**. (UNKNOWN — hosting-provider concern.)

## Third-party subscription dependencies (paid services)

Anthropic, OpenAI, Nous Research (Hermes), ElevenLabs, Twilio, Stripe (fees), Facebook/Meta (ad spend flows through the customer's own ad account), Google APIs, hosting (Railway), PostgreSQL (managed). See `ENVIRONMENT_AND_INTEGRATIONS.md` for keys/status.

## Honesty note

Exact dollar spend, per-feature real cost, and provider invoices are **not available in the codebase**. The `ai_usage_log` provides **estimated** costs only. Any real cost analysis must reconcile the ledger against provider billing dashboards. **No cost figures were invented for this document.**
