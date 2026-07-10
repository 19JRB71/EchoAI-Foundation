---
name: EchoAI Hermes decision brain
description: How Hermes 4 (Nous Portal) orchestrates Echo without becoming a single point of failure.
---

# Echo's Hermes 4 decision brain

Hermes 4 (Nous Research, OpenAI-compatible Nous Portal API) is Echo's **decision/orchestration** layer, NOT its writer. Split of duties: Hermes decides (intent, which of the 9 teammates owns the turn, on-topic?, brand-switch requested?, a one-sentence directive); Claude still writes all customer-facing content.

**Rule: the brain must never become a single point of failure.**
`echoOrchestrator.decide()` returns `null` (never throws) when Hermes is unconfigured OR fails/times out; `runEchoChat` treats a null decision as "no directive" and falls back to prior behavior. Never let an orchestration failure enter Claude's 502 path or break voice/streaming.

**Why:** `decide()` runs BEFORE Claude on every Echo turn, including the spoken voice path. A slow/down Hermes would otherwise stall every reply. So the orchestrator calls the shared `config/hermes.js` chokepoint with a **tight per-call budget (single attempt, ~6s)** — much shorter than the module default (15s×2) — via `opts.timeout`/`opts.attempts`. Override with `HERMES_ORCHESTRATOR_TIMEOUT_MS`.

**How to apply:**
- All Hermes calls go through `config/hermes.js` `createCompletion()` (mirrors `config/anthropic.js`: timeout + transient-only retry; 4xx never retried). `hermesConfigured()` gates.
- `NOUS_PORTAL_API_KEY` is a **feature var, not boot-critical** — missing → warn + Echo degrades, server still boots.
- The directive is injected as one extra system-prompt line in `runEchoChat` (after the "be warm/concise" line, before `knowledge`). Keep it additive; do not restructure streaming/markers.
- Keep the 9-agent roster in `echoOrchestrator.js` TEAM aligned with `client/src/lib/departments.js`.
- Nous Portal key works only from the Node/bash env, NOT the code_execution sandbox.
