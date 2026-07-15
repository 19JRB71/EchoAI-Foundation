# Zorecho AI Usage, Cost Tracking & Margin Protection — Phase 1 Audit

Prepared July 15, 2026. **No code was changed for this audit.** This is the
inventory, gap analysis, proposed design, and questions for your approval
before any implementation begins.

---

## 1. The headline finding

Zorecho already has a real usage-ledger foundation — more than expected. About
60% of what the spec asks for in Phases 1–2 exists today:

- **`ai_usage_log`** — a central AI ledger already records every Anthropic,
  Hermes, and OpenAI call with: environment, deploy version, provider, model,
  brand, user, agent, feature, task type, job name, **request_id**,
  conversation_id, triggered_by, input/output/cached tokens, web searches,
  retry count, duration, success/error category, **estimated_cost_usd**, cache
  hit/miss, and fallback flag.
- **`utils/aiGate.js`** — a mandatory admission gate in front of every LLM call
  (emergency switches, environment policy, budgets), with an
  AsyncLocalStorage-based ambient context (`aiContext`) that propagates
  user/brand/job/conversation identity down call chains.
- **`ai_budget_alerts` + `ai_settings`** — deduped budget-threshold alerts and
  admin-tunable budget overrides.
- **Sentinel API quota monitor** (`utils/apiQuotaMonitor.js`) — hourly sweeps
  of ElevenLabs characters and Twilio balance into `api_quota_snapshots`, with
  low/critical voice + push alerts, and honest "unavailable" status for
  providers that expose no quota API (OpenAI/Anthropic/Google).
- **Demo/environment separation** — `brands.is_demo`, `demo_tier`, and the
  ledger's `environment` column already keep test/demo spend out of customer
  attribution.

So the project is not "build a cost system from scratch" — it is **extend the
existing ledger to non-LLM providers, add workflow-level tracing, pricing
versioning, reconciliation, per-customer economics, and the customer-facing
meter.**

---

## 2. Provider & API inventory (everything that costs money)

### AI / LLM providers — all flow through chokepoints, all ledgered today

| Provider | Chokepoint | What it does | Usage data returned | Tied to customer? |
|---|---|---|---|---|
| Anthropic (Claude) | `config/anthropic.js` `createMessage`/`streamMessage` | All text generation: content, replies, analysis, every agent's writing | input/output/cached tokens, web-search request counts | Yes (aiGate context) |
| Nous Hermes-4 | `config/hermes.js` `createCompletion` | Echo Orchestrator decision brain: intent, routing, state | prompt/completion tokens | Yes |
| OpenAI DALL-E 3 | `config/openai.js` (gated SDK) | Image Studio, ad creatives, social graphics | per-image cost estimate (size/quality) | Yes |
| OpenAI Whisper | via gated SDK (`voiceController`) | Speech-to-text for voice conversations | estimated by audio size (no token usage) | Yes |
| OpenAI TTS | via gated SDK (`voiceController.synthesizeSpeech`) | Voice fallback when ElevenLabs fails | estimated by characters | Yes |

### Voice / communications providers — NOT in the ledger today

| Provider | Where | What it does | Usage data available | Tied to customer? |
|---|---|---|---|---|
| ElevenLabs | `utils/elevenlabs.js` | Primary TTS + sound effects | returns raw audio only; account-level character quota via their API | Indirectly (brand config) — **not per-request ledgered** |
| Twilio Voice | `phoneController` | AI phone agent calls (in/out) | call SID; duration arrives later via status webhook; per-minute billing | Yes (brand's number) — **not ledgered** |
| Twilio SMS | `smsMarketingController`, assistant reminders, alerts | 2-way SMS, drips, owner alerts | message SID; segments derivable; billing via Twilio usage API | Yes — **not ledgered** |
| SMTP email | `utils/email.js` (nodemailer) | Campaigns, drips, notifications | messageId only; cost depends on your SMTP provider | Yes — **not ledgered** |
| IMAP | `utils/emailAccounts.js` | Email Assistant inbox sweeps | none (infrastructure, usually free) | Yes |

### Other external APIs — free or usage-capped, currently unledgered

| Provider | Where | Cost reality |
|---|---|---|
| Facebook Graph API | `utils/facebookApi.js` | Free API; the *ad spend* it triggers is customer money, already tracked separately |
| Google OAuth / Calendar / Ads | various | Free API calls |
| YouTube Data API | `musicController` | Free but quota-capped; **global key, no customer attribution** |
| Google Custom Search | `utils/socialApi.js` | Small per-query cost above free tier; **global key, no customer attribution** |
| Stripe | billing | Percentage fees on revenue, reported by Stripe itself |
| Web push / FCM | push alerts | Free |

### Requests that cannot currently be tied to a customer

- YouTube music search and Google Custom Search (global keys, no aiGate).
- Platform-level jobs (quota sweeps, admin self-review) — correctly "Zorecho
  overhead," but should be *explicitly labeled* as such, not left unassigned.
- Twilio/ElevenLabs/SMTP per-request usage — attributable in principle (we know
  the brand at every call site) but not recorded anywhere today.

---

## 3. Echo Orchestrator prototype — current architecture

- `utils/echoOrchestrator.js` + `config/hermes.js`: Hermes-4 classifies each
  user message into a strict JSON decision — agent (one of the 9 teammates),
  intent, on-topic, brand-switch, directive. Claude then writes the actual
  reply with the directive injected into its system prompt.
- Voice pipeline fan-out per utterance: Whisper STT → Hermes decision → Claude
  reply → ElevenLabs/OpenAI TTS. One spoken question = 3–4 paid calls minimum.
- Autonomous Conversations: Hermes reads intent/state/buying signal, Claude
  writes, per lead reply — a fan-out chain per inbound message.
- **Tracing today:** every LLM call gets its own `request_id` (UUID) and the
  ambient context carries `conversationId`, `jobName`, `triggeredBy`. What's
  missing is a **workflow/trace ID spanning the whole chain** — today you can
  see the 4 calls a voice turn made, but nothing groups them into "this one
  request cost $0.11 total."

## 4. Background jobs that spend money (22 found)

All AI-consuming jobs already exclude demo brands; operational senders
(follow-ups, drips, reminders) run for all brands by design.

High-frequency / highest-cost-risk jobs: Sage urgent scan (30 min), competitor
+ competitor-ad scans (6 h), Sage deep cycle (6 h), health monitor (hourly),
real-estate Nova content (3×/day), weekly Autopilot + analytics + learning
(Mondays), daily growth engine, closing summaries, drips, follow-up
touchpoints, personal reminders (Twilio). Full table in section 10 appendix.

None of these currently report **cost per useful result** — the spec's "flag
jobs that spend without producing output" requires joining ledger rows to
"was anything shown to the customer," which the ledger's `job_name` column
already makes possible.

## 5. Existing revenue side

- `subscriptions` (+ Stripe IDs) is the tier source of truth;
  `config/plans.js` prices: Starter $197, Professional $497, Enterprise $997,
  +$50/seat (legacy hidden `growth` $99). Revenue per customer = tier price +
  seats, or (better) actual Stripe invoice totals via the Stripe API.
- Gross margin per customer is therefore derivable once non-LLM costs land in
  the ledger.

---

## 6. Proposed database design (for approval — nothing created yet)

**Principle: extend the proven `ai_usage_log` pattern rather than build a
parallel system.** Rename conceptually to "usage ledger"; the table stays.

1. **`ai_usage_log` — add columns** (all nullable, backward compatible):
   `workflow_id` (groups a full orchestrator chain), `parent_request_id`,
   `unit_type` + `unit_quantity` (characters / seconds / minutes / segments /
   emails / images / searches), `provider_ref` (Twilio SID, SMTP messageId —
   for reconciliation), `pricing_version_id`, `reconciled_cost_usd`,
   `reconciliation_status` (estimated / reconciled / mismatch / unbillable),
   `provider_charged_on_failure` (bool), `key_label` (which API key/project,
   never the secret).

2. **`pricing_config`** — versioned rates: provider, model/service, billing
   unit, input/output/cached rates, per-character, per-minute, per-image,
   per-segment, per-search rates, currency, `effective_from`. Ledger rows
   store the version used; history never re-priced. Admin-editable.

3. **`provider_reconciliation_runs`** — one row per scheduled pull per
   provider: window, provider-reported total, our estimated total, delta,
   unmatched count, status. Twilio (full usage API), ElevenLabs (character
   counters), Anthropic/OpenAI (usage/cost APIs where the org exposes them),
   Stripe (fees). Originals never overwritten — reconciled cost is a separate
   column.

4. **`usage_allowances`** — per-plan included capacity: internal cost
   allowance per tier (and optional per-category voice/comms sub-allowances),
   alert thresholds, overage policy enum (notify / require pack / upgrade /
   approved-auto / downgrade-model / pause-optional). Prices left
   configurable, not hardcoded.

5. **`usage_alert_log`** — extends the existing `ai_budget_alerts` pattern to
   per-customer 50/75/90/100%/projected-overage alerts, deduped per cycle.

6. **Write-safety** — usage writes stay non-blocking (they already are:
   ledger failure never fails the customer request). Add a tiny in-process
   retry queue + an hourly "unwritten usage" sweep alert so nothing is
   silently dropped. Idempotency via `request_id` unique index.

**Event/trace structure:** one `workflow_id` (UUID) minted at every entry
point (chat message, voice utterance, inbound lead message, background job
tick, orchestrator request) and carried in the existing `aiContext` — zero
per-call-site changes for LLMs; new instrumentation wraps ElevenLabs, Twilio,
and email at their single chokepoints (`elevenlabs.js`, the Twilio client
wrapper, `email.js`).

---

## 7. Reconciliation options per provider

| Provider | Option | Reliability |
|---|---|---|
| Twilio | Usage Records API + per-call/message pricing on status webhooks | Excellent — true billed cost per SID |
| ElevenLabs | Subscription character counter (already polled by Sentinel) | Good — account level, prorate across our character log |
| OpenAI | Usage/Costs API (org-scoped) | Good — daily totals; per-request stays estimated |
| Anthropic | Usage & Cost Admin API (requires admin key) | Good — daily totals |
| SMTP | Depends on provider; often flat/infra | Estimate only; admin-entered rate |
| Google Search / YouTube | Console quotas only | Estimate only |

## 8. Risks & unknowns

1. **Plan-price mismatch**: `config/plans.js` says $197/$497/$997 while
   earlier project docs said $100/$350/$550 — confirm which is current before
   margin math ships.
2. **ElevenLabs is account-level**: per-request character counts must be
   logged by us (we have the text length — easy) but reconciliation is
   proration, not exact.
3. **Twilio duration arrives late** (status webhook) — ledger rows for calls
   get written as pending and finalized on the webhook; that path must be
   idempotent.
4. **Anthropic/OpenAI usage APIs** may need higher-privilege/admin keys than
   the ones configured; if unavailable, those providers stay estimate-only
   (clearly marked) — the spec allows this.
5. **Voice tiers** (Standard/Professional/Executive) don't exist yet as a
   product concept — the ledger design supports them (model + unit rates per
   tier), but tier definitions/prices are a product decision.
6. **Cost-aware routing** changes live behavior (model downgrades, caching) —
   highest quality risk; scheduled last and behind per-feature switches.

## 9. Implementation estimate by phase

| Phase | Work | Relative size |
|---|---|---|
| 1. Ledger extension + workflow trace IDs | Add columns, mint workflow_id at entry points, instrument ElevenLabs/Twilio/email/search chokepoints | Medium |
| 2. Pricing config + cost engine | `pricing_config` table + admin editor, estimator switches to versioned rates | Medium |
| 3. Orchestrator integration | Workflow chain view (per-request cost breakdown incl. delegated agents) | Small–Medium (tracing from Phase 1 does most of it) |
| 4. Reconciliation | Twilio + ElevenLabs first, then OpenAI/Anthropic; nightly job + mismatch flags | Medium |
| 5. Owner AI Economics Dashboard | Revenue vs cost vs margin, filters, top-cost lists, background-job cost-per-useful-result | Large |
| 6. Customer AI Workforce Capacity meter | % of included capacity, breakdown, plain-English explanations | Medium |
| 7. Alerts, overage packs, cost-aware routing, caching | Most product decisions live here | Large, gated on your pricing decisions |

## 10. Questions requiring your decision

1. **Which plan prices are correct** — $197/$497/$997 (current code) or
   another set? Margin math depends on it.
2. **Included capacity per tier**: do you want to define it as an internal
   dollar allowance (e.g., Starter includes $X of AI cost/month — simplest and
   most honest internally), or as abstract "capacity units"? Customers only
   ever see percentages either way.
3. **Default overage policy at launch**: notify-only (recommended while in
   private testing)?
4. **Should Sage/Scout background scan frequencies become plan-dependent**
   (e.g., Enterprise 30-min urgent scans, Pro hourly)? That's the single
   biggest background-cost lever.
5. **Voice tiers**: do you want Standard/Professional/Executive voice mapped
   to your existing Starter/Pro/Enterprise plans, or sold as a separate
   add-on dimension?
6. **Anthropic/OpenAI admin usage keys**: are you able to provide org-admin
   keys for reconciliation, or should those two stay estimate-only for now?

---

### Appendix: background jobs inventory

| Job | Frequency | Paid providers | Demo-excluded |
|---|---|---|---|
| weekly-analytics | Mon 08:00 | Anthropic, OpenAI | Yes |
| weekly-autopilot | Mon | Anthropic, OpenAI | Yes |
| weekly-learning study | Mon 05:00 | Anthropic | Yes |
| Sage self-review | Mon 07:15 | Anthropic | admin-only |
| sage-deep-cycle | 6 h | Anthropic (+search) | Yes |
| sage-urgent-scan | 30 min | Anthropic (+search) | Yes |
| competitor-scan / competitor-ad-scan | 6 h | Anthropic, FB API | Yes |
| health-monitor-sweep | hourly | Anthropic | gated |
| daily-growth | daily | Anthropic, FB API | Yes |
| closing-summaries | daily | Anthropic | Yes |
| re-listing-promo / re-seller-lead-ads / re-open-house / re-nova-content | hourly–daily | Anthropic, FB, email | Yes |
| social-publish | 1 min | social APIs | operational |
| follow-up-touchpoints | 5 min | Twilio, email | operational |
| drip-emails | hourly | email | operational |
| personal-reminders / daily-task-sweep | 1 min / daily | Twilio | partial |
| api-quota-sweep | hourly | (monitor only) | n/a |
| autonomous-timeout | 15 min | none (DB) | n/a |
| daily-goal-tracking | daily | none (DB) | Yes |
