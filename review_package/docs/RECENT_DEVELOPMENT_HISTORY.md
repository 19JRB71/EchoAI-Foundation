# Recent Development History — Zorecho (EchoAI)

Prepared: 2026-07-24. Source of evidence: the project's actual git log (765 commits, first commit 2026-06-10, HEAD `ae50e8a648f806642f9eb9ab1d7b53a74cf118e4` dated 2026-07-24). Commit messages are quoted or paraphrased from the real log; where a change's rationale is not documented in the log or repo docs, it is marked UNKNOWN rather than invented.

## Development timeline (high level)

| Period | Focus |
|---|---|
| 2026-06-10 → 06-29 | Initial platform build: core SaaS features (ads, chatbot, brand discovery, billing, social, email, SEO, reputation, phone agent, etc.) |
| 2026-07-02 → 07-10 | Rapid feature expansion + hardening (heaviest period: 104 commits on 07-07 alone); voice engine, Echo companion, autonomous conversations, guided setup |
| 2026-07-11 → 07-13 | **Zorecho rebrand** (customer-facing name change; internal identifiers kept as EchoAI), Mission Control V2 visual rebuild, cost-control ledger for paid AI paths |
| 2026-07-14 → 07-16 | Guided Setup Wizard, Vision (10th agent) + Reference Library, Forge Creative Director Engine, Hybrid Creative Engine, Sage Pattern Intelligence, Autopilot refinements (posts-only, instant post, photo variety), fix for OpenAI retiring dall-e-3 |
| 2026-07-17 → 07-19 | **Sage V2 program** (Phases 1–6, most behind feature flags that default OFF), Company Truth, operational roadmap + engineering constitution documents, Collaboration Bus Stage 0 (built dark, flags OFF) |
| 2026-07-19 → 07-24 | **Staging environment milestone**: staging branch, Railway staging service (staging.zorecho.com), env-var policy, runtime Stripe key resolution fix, Google OAuth verified on staging (2026-07-23, by the CEO, real end-to-end connect), Facebook staging config in progress; TTS language pinning fix; brand-discovery auto-save-on-confirm fix (2026-07-24) |

## What has required repeated fixes (recurring problem areas)

Evidence: multiple commits over multiple days targeting the same subsystem.

1. **Voice engine / speech recognition** — by far the most-revisited area (dozens of commits across 07-05 → 07-24): wake-word detection, self-echo filtering, stale closure state, barge-in, autoplay unlock, blocked-audio banners, playback diagnostics, briefing scoping after brand switch. The repo's own memory notes treat the voice pipeline as fragile; a "voice flight recorder" diagnostic was added specifically because live voice bugs recur.
2. **Autopilot content batching** — repeated adjustments (cadence honoring, posts-only scope, declined-post replacement, checkbox persistence, spacing rules, streaming for large Anthropic requests, timeout fixes) across 07-14 → 07-16.
3. **Image generation & media persistence** — OpenAI retiring dall-e-3 broke generation (fixed 07-14); Railway's ephemeral disk wiped uploads (fixed 07-16 by moving media to Postgres BYTEA with disk as cache); repetitive Instant Post images (fixed 07-17).
4. **Facebook posting/connection** — text-only post bug, page-connection reset steps, durable media storage; staging OAuth connect remains untested as of 2026-07-24.
5. **Deployment/Railway specifics** — nixpacks npm install failures (switched to Yarn), registry URL fixes, ephemeral disk, runtime client config (VITE_* vars unavailable to the pre-built bundle), fresh-DB schema bootstrap ordering.

## What was added recently (July highlights, per commit log)

- Guided Setup Wizard (new-customer front door), 07-14.
- Vision — 10th AI agent + Reference Library, 07-15.
- Forge Creative Director Engine + Hybrid Creative Engine + Sage Pattern Intelligence, 07-16.
- Sage Company Truth (versioned company intelligence report), 07-16.
- Sage V2 Phases 1–6, 07-17 → 07-19 — **large parts are feature-flag-gated and dark by default** (flags OFF in production). The commit log states this explicitly.
- Collaboration Bus Stage 0, 07-19 — built dark, all COLLAB_* flags OFF, Stage 1 not started.
- Staging environment (code + Railway service + branch), 07-19 → 07-24.
- Echo Guided brand-discovery auto-save on confirmation, 07-24 (fixes a hidden dead end where the CEO's own brand profile was lost).

## What was paused / is intentionally dark

- Sage V2 advanced features (multiple phases): flags OFF by default.
- Department Collaboration Stage 1: awaiting explicit CEO go-ahead (Stage 0 infrastructure exists but is inactive).
- Voice-First Architecture rework: vision document approved for a future milestone; no build yet.
- Monday AI stack (analytics/learning/autopilot-study/self-review/cross-business) and Sage urgent scan: switched off pending re-enable via AI controls (per server boot log, 2026-07-24, dev environment).

## What introduced regressions (documented cases)

- The OpenAI dall-e-3 retirement (external change) broke image generation until 07-14.
- Railway ephemeral disk silently destroyed uploaded media between deploys until the BYTEA fix (07-16).
- A newly added React component with a bad import could pass unit tests but break the production Vite build (documented as an internal lesson; the client-build validation step was added to catch this).
- The brand-discovery flow told users they were "all set" without saving (found 2026-07-23 when the CEO's own brand profile was lost; fixed 2026-07-24).

## What is currently being stabilized

- Staging environment integration testing: Google OAuth verified end-to-end on staging (2026-07-23); Facebook OAuth connect on staging configured but **not yet tested**; Stripe on staging uses runtime key resolution.
- Echo's TTS language pinning (fix shipped 2026-07-24; awaiting staging verification).

## Caveats

- Many commits are auto-titled by the development tooling ("Add image asset…", "Add initial project structure…") and carry no substantive information; they were excluded from the analysis above.
- This document summarizes the git log; it does not itself prove any feature works. See FEATURE_STATUS_MATRIX.md and REAL_ACTIONS_VS_SIMULATED_ACTIONS.md for functional claims and their evidence.
