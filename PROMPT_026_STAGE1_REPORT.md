# PROMPT 026 — STAGE-1 REPORT (READ-ONLY)

**Date:** 2026-08-13 · **Author:** Replit (observer) · **Package:** PROMPT 026 STAGE-1 ISSUE PACKAGE (FINAL, authorized 2026-08-13)
**Stage-1 discipline honored:** no code changes, no config changes, no provider calls beyond the existing read-only `google-preflight`/`preflight` endpoints, no DB writes anywhere, no runbook execution, no fixes. The only files created: `OWN_BUSINESS_TEST_RUNBOOK.md` (13d deliverable) and this report.

---

## 1. Gate audit (13a)

**Consolidated finding first:** no file named `07_TEST_EVIDENCE_INDEX` exists in the repo. The authoritative evidence index is `TEST_EVIDENCE_INDEX.md` at the staging-branch head (bd73b013, fresh clone; last updated 2026-08-03 — the workspace copy is stale at 2026-07-26, which is exactly the D-37 drift warning). Gate letters are not tabulated anywhere as "Gate A…G" rows; they are recorded per-prompt in `CHANGELOG.md`/`TEST_EVIDENCE_INDEX.md`/`COMPLETED_WORK.md` in the clone. Reconstruction:

| Gate | Substance | Evidence (clone, bd73b013) |
|---|---|---|
| A (Phase A honesty/lifecycle) | Prompt 005 v2 honest campaign lifecycle; created_paused/live via verification authority only | CHANGELOG (PR #17, `6a5e508`, migration 128, +16 tests, 1014/1014); COMPLETED_WORK Phase-A preflight (SHA `62ea1fc` ancestry) |
| B (Facebook real-action proof) | Prompt 015 spend caps + no-cap-no-unpause; real FB publish/read-back path | CHANGELOG 015 entries; ad_spend_caps row live on staging (read 2026-08-13: platform row $25.00/day) |
| C (Google real data) | Prompt 016 GA4 pull proven live (`prompt016-live-1`, properties/473906255); GBP honestly UNVERIFIED (quota 0 → I-30) | CHANGELOG:19 "closes Phase C / Gate C"; external_proofs `google|analytics_pull` row present (read 2026-08-13) |
| D (task spine) | Prompts 009/018: ad-launch spine, single canonical POST /ads, origin propagation | TEST_EVIDENCE_INDEX 2026-08-02 section (1105/1105, migration 132) |
| E (email spine + inbox) | Prompt 019: email-send spine, Approvals Inbox, live Message-ID proof `prompt019-live-1` | TEST_EVIDENCE_INDEX 2026-08-03 section (task `e30037ae`, proof `18cc94aa`); external_proofs `email|send_accept` ×3 present |
| F (external actions ledger) | Prompt 020: external_actions ledger (migration 134), DB-level idempotency, MANUAL_REVIEW parking | CHANGELOG:6 (suite 1125/385) |
| G (knowledge/first-win/Echo honesty) | Prompts 011/022/023/024/025: knowledge versions w/ provenance, interview, armed first win, Echo claim matrix | staging rows read 2026-08-13: brand_knowledge_versions=17, onboarding_first_win_celebrations=1, facebook publish_readback/launch_readback/delete proofs |

- **033 / E-32:** CLOSED with owner final acceptance 2026-08-13 (live Case-1 proof, 409 gate, C1–C4 cleanup/survivorship all PASS; campaigns history row `32cea08b…` retained by ruling; I-47/I-48 filed).
- **I-29:** PENDING — due on or after 2026-08-14 (tomorrow); NON-GATING per the Section-5 rule. Current grant snapshot (read-only, 2026-08-13 18:47 UTC): connected, refresh token present, re-minted 2026-08-07; the survival check itself is tomorrow's work.
- **I-30 / GBP:** SUBMITTED 2026-08-13, Google case **4-9287000040750**, 7–10 business days. Live re-check today: `businessProfile.reachable:false`, quota-exceeded for `project_number:512879708312` — i.e., not yet granted. All GBP runbook rows are therefore currently **UNVERIFIED-PENDING-I30**. Details in `CURRENT_STATE.md` §I-30.

## 2. Production environment audit (13b) — findings table

Probed read-only from this workspace on 2026-08-13. **Access limitation disclosed honestly:** no production DB URL secret exists here, no Railway API/dashboard access; env-var-level checks below are OWNER-ASSISTED items, not silently skipped.

| # | Check | Result | Disposition (proposed) |
|---|---|---|---|
| F-1 | **`app.zorecho.com` does not exist in public DNS** (NXDOMAIN via Google DoH; authority = GoDaddy nameservers). All project docs name it as the production URL. | **CRITICAL FINDING** — production is not publicly reachable at its documented domain. Either the CNAME was never created, or it was removed. | Owner: check Railway production service → Networking (custom domain state) and GoDaddy DNS for the `app` record. Nothing fixed by me. |
| F-2 | `zorecho.com` apex serves a **GoDaddy parking lander** (`window.LANDER_SYSTEM="PW"`, `ap:"parking"`); `/api/health` = 404 | Production traffic to the apex hits a parking page, not the app or a marketing site | Owner decision: intended? (I-14's "which Railway config is live" cannot even be probed until F-1 is resolved) |
| F-3 | Staging health | `{status:ok, environment:staging, version:bd73b013…}` — matches expected deploy SHA exactly | None — healthy |
| F-4 | Staging scheduler posture | job_runs ticking to within the current minute (voice-reminders/social-publish/personal-reminders, outcome=success) | None — single-replica claims working |
| F-5 | 015 platform cap row (staging) | ad_spend_caps row present: platform cap 2500 cents = $25/day (created 2026-07-30) | None — matches the mandated pilot row |
| F-6 | No global `FACEBOOK_LINK_URL`/`FACEBOOK_PAGE_ID` on production (I-5/D-20) | **CANNOT VERIFY from here** (needs Railway prod variables view) | OWNER-ASSISTED: screenshot Railway prod variables (names only, values hidden) during Stage-2 prep |
| F-7 | Migration head parity prod vs staging | **CANNOT VERIFY** (no prod DB access) | OWNER-ASSISTED or via a read-only admin endpoint once F-1 restores reachability |
| F-8 | Which Railway config is live (I-14), build/SW state | **CANNOT VERIFY** until F-1 resolved | Blocks H2 entry per runbook Phase P.2 |
| F-9 | OAuth callbacks (FB + Google) for production | **CANNOT VERIFY** provider-side from here; staging's are proven | OWNER-ASSISTED: Meta app + Google Cloud console screenshots at Stage-2 prep |
| F-10 | Email transport (prod) | **CANNOT VERIFY**; staging: smtp.resend.com, from `Zorecho <no-reply@zorecho.com>` (preflight read) | OWNER-ASSISTED |
| F-11 | Workspace repo drift | Workspace HEAD `129169f8` ≠ staging head `bd73b013` (workspace has extra doc/asset commits) | None for 026 — baselines were taken from the fresh clone, not the workspace (D-37) |

**Net:** H2 cannot begin planning-level entry until F-1/F-2 are resolved — production is currently unreachable at its documented address. This does not delay H1.

## 3. Asset inventory + owner-credential checklist (13c)

**Staging today (read-only DB, 2026-08-13):**
- Users: admin@staging.zorecho.com (owner/admin) + beta/smoke test users.
- Brands: exactly ONE non-demo brand — **Pole Barn Kits** (owned by admin@staging). **There is NO "South Dixie Storage" brand row and NO "Blacor Homes" brand row on staging.**
- User-scoped connections (on admin@staging): Facebook connected (Page **South Dixie Storage**, id 140006069194366, category "Portable Building Service"; ad account act_818682760732833; page token present; page read-back clean today) · Google connected as **southdixiestorage@gmail.com** (business.manage, adwords, analytics.readonly, calendar, webmasters; GA4 properties/473906255 reachable with real data today).
- History: 12 campaigns, 16 external_proofs (email/facebook/google/stripe), 17 knowledge versions, 1 first-win celebration — all attached to the Pole Barn Kits proof-run lineage.

**FINDING A-1 (owner decision embedded in the runbook):** the package's premise "SDS exists on staging with history → SDS-H1 exercises ongoing-operation workflows on the existing brand" does not match the DB: the *connections* are SDS-flavored, but the only brand with history is **Pole Barn Kits**, which Section 12 explicitly excludes as an earlier-proof-run leftover. Options for your ruling at Stage-2 authorization: (a) SDS-H1 begins with a fresh SDS onboarding on staging through product surfaces (making SDS-H1 = onboard + operate, and staging exercises TWO fresh onboardings), or (b) SDS-H1 runs the OPERATE/VERIFY phases on the existing Pole Barn Kits brand as the "brand with history" (accepting that it is a leftover). The drafted runbook assumes (a) as the conservative default; flag if you prefer (b).

**Real-world assets:** SDS — website southdixiestorage.com, FB Page (above), ad account (above), GA4 473906255, real GBP listing (verified, ~2 years; now owner/manager-linked to jamesRblacketer71@gmail.com as of today). Blacor Homes — **nothing recorded in the repl**: no brand row, no connections, no documented FB Page/ad account/GA4.

**Owner-credential checklist (needed before Stage 2, gather — do not create):**
1. Blacor Homes FB Page admin access (which Page? — id needed) on the FB account you'll OAuth with.
2. Blacor ad-account access (or ruling that Blacor's runbook skips the ad chain — R6 says at most one chain per ENVIRONMENT anyway, so SDS can carry it).
3. Blacor GA4 property — **if none exists, that is honest data; do NOT create one for the test.**
4. Blacor website URL for research/knowledge.
5. For H2: production login credentials for the two fresh tenant signups (owner-controlled inboxes).

## 4. The drafted runbook (13d)

**`OWN_BUSINESS_TEST_RUNBOOK.md`** (workspace root) — complete template: instance header, verbatim R1/R2/R4/R5/R6 obligations, evidence rule, narrow blocking-bug rule, and phases 0 (preflight) / 1 (ONBOARD) / 2 (OPERATE) / 3 (VERIFY) / P (PRODUCTION ENTRY incl. smoke gate) / C (CLOSE: cleanup, survivorship, sign-off), plus a Notes-for-027 register. Every step row carries actor / surface / expected behavior / evidence source / pass criterion / R2 classification. It is a template for your edit/approval — nothing in it is executable authorization.

## 5. Proof matrix instantiated (Section 16)

| Row | SDS-H1 (staging) | BLACOR-H1 (staging) | SDS-H2 (prod) | BLACOR-H2 (prod) |
|---|---|---|---|---|
| Sage research + provenance | per A-1 ruling | ✔ (fresh) | ✔ (fresh) | ✔ (fresh) |
| Review/correct knowledge versions | per A-1 | ✔ | ✔ | ✔ |
| Interview gap-only + reason codes | per A-1 | ✔ + RE branch (brand_type) | ✔ | ✔ + RE branch |
| First win armed chain → exactly-one celebration | per A-1 | ✔ | ✔ | ✔ |
| Organic post via inbox → spine → read-back | ✔ | ✔ | ✔ | ✔ |
| **Ad chain (R6: max ONE per environment, single-attempt)** | ✔ (carries the staging chain) | — | ✔ (carries the prod chain) | — |
| Email send → Message-ID (owner inbox) | ✔ | ✔ | ✔ | ✔ |
| GA4 pull | ✔ (473906255) | only if a Blacor GA4 exists (else honest absence) | ✔ | same rule |
| GBP items | UNVERIFIED-PENDING-I30 (re-check each phase preflight) | n/a unless Blacor has a GBP | same | same |
| Echo cross-checks / cross-brand negatives / ops tiles | ✔ | ✔ (incl. A↛B both directions) | ✔ | ✔ |
| Smoke gate | n/a | n/a | **P.3 before either H2 instance** | gated by same pass |
| Cleanup + survivorship | ✔ | ✔ | ✔ | ✔ |

## 6. Smoke-action recommendation (13e / 6A)

**Recommendation: a spine email send to an owner-controlled inbox, with Message-ID proof.** Argued against the alternatives from what 13b actually found:
- **Email (recommended):** exercises real production machinery end-to-end (approval surface → email spine → external_actions ledger → SMTP → `send_accept` proof with Message-ID) with ZERO public persistence, zero spend, no provider-side cleanup burden (inbox message simply recorded), and the exact live-proof pattern already validated on staging in Prompt 019. It is the only candidate that produces a full internal task/proof/ledger trail while remaining invisible to the public.
- FB organic post (TEST + delete): real but leaves a public artifact window and requires provider-side deletion — more moving parts for first contact with an unproven environment.
- GA4 pull: safest but too weak — read-only, exercises no write machinery, and 6A's purpose is proving the production WRITE path.
**Caveat:** F-10 (prod email transport unverified) means the smoke test doubles as that verification — which is precisely what a smoke gate is for. If the send fails, it fails cleanly, privately, and with evidence.

## 7. Integration availability table

| Integration | Status for 026 | Honest ceiling |
|---|---|---|
| Facebook (OAuth, page, organic publish, ad chain) | AVAILABLE (staging-proven; page read-back clean today) | ad chain: R6 single-attempt, PAUSED/$0 only |
| Google GA4 | AVAILABLE (reachable with real data today) | read-only pulls |
| Google GBP | **CONDITIONAL — pending I-30** (case 4-9287000040750) | UNVERIFIED-PENDING-I30 until quota flips; never simulated |
| Email (spine) | AVAILABLE (staging SMTP verified; prod transport = smoke gate) | owner-controlled inboxes only |
| SMS/Twilio | SKIPPED (D-11; no spine correlation) | feature-only per 025 |
| Voice external actions | SKIPPED | — |
| Stripe live billing | OUT (029's domain; test-mode state untouched) | — |

## 8. Scope-guard / spend / content confirmations

Confirmed understood and embedded verbatim in the runbook: Section-2 non-scope (no I-47/I-48/I-44–46/I-40–43 fixes, no 031 retry work, no 027 automation, no non-owned data, no Hermes changes, no I-21) · R1 zero spend / no unpause path · R2 classify-before-write, TEST-by-default · R4 one attempt · R5 owner-only approval via product surfaces · R6 verbatim · Section-12 no synthetic data in production ever, leftovers untouched · Section-17 script-shaped steps become 027 notes. No conflict found between the package and any standing rule. **No STOP condition encountered in Stage 1.**

## 9. Baselines (13f, D-37)

Fresh GitHub clone `/tmp/p026stage1` (outside checkpoint-managed paths), branch `staging`, **HEAD verified = bd73b013104f959e8ef2e99b564cf2885448f832** (equals the deployed staging SHA from `/api/health`).
- **Server: 1370/1370 PASS** (six sequential `node --test` chunks against the isolated test DB; 187+302+234+214+258+175; 0 fail / 0 cancelled; logs `/tmp/p026_run_a{a..f}.log`). Matches the 1370 reference exactly.
- **Client: 430/430 PASS across 41 test files** (vitest, three chunks: 92+90+248; logs `/tmp/p026_crun_a{a,b,c}.log`). Matches the 430/41 reference exactly.
- **Client production build: GREEN** (`vite build` on the clone, exit 0).
- **Method deviation, recorded honestly:** `npm install` in the fresh clone was blocked by the workspace package firewall (403 on registry tarballs). Since the clone's `package-lock.json` files (server AND client) are byte-identical to the workspace's (`diff -q` proven), the workspace `node_modules` trees were copied into the clone. Source code = pure GitHub clone; dependency artifacts = lockfile-identical copies. The suites ran with the clone's code only.

## 10. Expected Stage-2 change surface

`OWN_BUSINESS_TEST_RUNBOOK.md` instances (filled) + narrowly-authorized D-43(7) mini-cycle fixes only. **Migration: NONE expected** — any schema need = STOP AND REPORT.

## 11. STOP items / owner decisions required before Stage 2

1. **F-1/F-2 (production DNS/domain)** — must be resolved (owner-side, Railway + GoDaddy) before any H2 planning is real. H1 is unaffected.
2. **A-1** — SDS-H1 shape: fresh SDS onboarding (runbook default) vs operating on Pole Barn Kits.
3. Owner-credential checklist §3 (Blacor items) gathered.
4. OWNER-ASSISTED 13b items (F-6, F-9, F-10 evidence) at Stage-2 prep.
5. Runbook approval (edit `OWN_BUSINESS_TEST_RUNBOOK.md` as you see fit).

— END OF STAGE-1 REPORT. STOPPING for owner authorization per the package protocol. —
