# BLACOR-H1 — Facebook Page / tenant-isolation gate

## Ruling

**HARD STOP — ARCHITECTURAL REPAIR REQUIRED**

The existing second-business gate cannot establish BLACOR's correct Facebook
Page when the connected user's only granted Page is South Dixie Storage.
There is no owner-visible connect-different-Page or reject-unrelated-Page
control in this one-Page state. “Skip this step” avoids the operation but does
not correctly configure BLACOR; it is not a reason to continue this test.

**No SDS binding was found on BLACOR.** This is a blocked selection/recovery
journey with a dangerous suggested choice, not evidence of an already completed
cross-business Page binding.

## Scope, authority, and dates

- Database: staging only; repeatable-read, read-only transaction, rolled back.
- Main snapshot: `2026-09-10 14:13:49.835027+00`.
- Additional owner-wide action check: `2026-09-10T14:14:34.387394Z`.
- Source: GitHub staging ref resolved to
  `de8e996f55fd5139a5488f75f7d96078f9dc25c6`, the previously verified release.
- Read actual `EchoAI/` source at that SHA, not workspace or review-package
  source copies. This investigation did not independently reverify Railway.
- Screenshot is owner-provided; no automated browser visited the app.
- No app endpoint, OAuth, Facebook/Google provider API, execute, save, retry,
  scheduling, launch, deployment, or production operation was invoked.
- “Stop” is the operational ruling, NOT a database pause/revoke. No mutation
  was authorized. The persisted session is still `in_progress` with consent.

## Exact identity and current session

| Item | Value |
|---|---|
| BLACOR brand | `65292e37-c1b2-4c04-b2c5-5167dbb04581` |
| Owner | `8e55c26c-7ac2-4ea6-9884-1703b0806016` |
| Setup session | `0e2decb1-e411-45cb-9810-2eeb26c4c142` |
| Status | `in_progress` |
| Consent granted | `true` |
| Consent timestamp | `2026-09-10T14:03:47.160Z` |
| Executing | `false` |
| Executing timestamp | `null` |
| Session updated | `2026-09-10T14:07:07.226Z` |
| Discovery session | `0bc72813-beeb-4714-9be9-9afd33335b96` |

Completed steps, in persisted order:

1. `create_brand_profile`
2. `set_availability`
3. `connect_google`
4. `content_calendar`
5. `ad_creatives`

The owner progressed beyond the previous pre-authorization checkpoint. Its old
“no consent/no artifacts” state must not be reused as current evidence.
The current screen and server branch identify the next step as
`create_facebook_campaign`, paused in the UI for `missing_ad_destination`.
The old `paused_at` timestamp is not evidence that the current database status
is paused.

## The three stores — precise distinction

The deployed architecture names the stores as follows. A Page ID and
destination for advertising BOTH live in Store 3; Store 2 is social publishing.

### Store 1 — user-level Facebook authorization and granted assets

Integration `0503d3d5-0b11-424a-ad85-cd0480257d93`, keyed to the owner above:

- platform `facebook`; status `connected`;
- `facebook_pages`: exactly one entry,
  `140006069194366`, name `South Dixie Storage ` (trailing space in stored name);
- `page_ref`: `140006069194366`;
- selected ad account `account_ref`: `act_185098744942162`;
- stored ad-account list names that selection `backwood barns`;
- stored list also includes a separate `BlaCor Ads` account
  `act_1694378501604002` — **an ad account is not a Facebook Page**;
- updated at `2026-09-10T14:07:08.478Z`.

This shared authorization is why SDS appears. Neither `page_ref` nor membership
in the granted-assets list establishes that the Page represents BLACOR.
The source will use the user-level selected ad account for a later launch;
it is not copied into a BLACOR campaign now. The current Page gate also does not
offer an ad-account chooser. Treat later launch identity as a separate review.

### Store 2 — brand-specific social publishing binding

- BLACOR: **zero `social_accounts` rows**.
- SDS: account `4ed1a620-18e5-4ed7-84db-d18a6ede340f`,
  brand `d5745758-30a6-462a-baa6-4233216b8f93`, platform Facebook,
  username `South Dixie Storage `, connected.
- SDS social row created/updated `2026-08-21T16:51:28.339Z`.
- Credential values were not fetched or decrypted; canonical comparison uses
  a presence boolean only.

### Store 3 — brand-specific advertising Page and destination

BLACOR:

```text
brands.facebook_page_id = null
brands.ad_link_url      = null
```

SDS primary brand:

```text
brand_id         = d5745758-30a6-462a-baa6-4233216b8f93
facebook_page_id = 140006069194366
ad_link_url      = https://southdixiestorage.com/
updated_at       = 2026-08-19T06:26:06.889Z
```

The other two historical SDS brands remain banked:
`bfe13534-f06d-4206-8139-3c217a52c8da` and
`ae125e32-f130-4b5c-8c68-1f41cfd8ae20`; their ad Page/destination fields are null.

## BLACOR artifacts and consequential-action footprint

The all-brand-table bank covers 118 tables having `brand_id`, plus the
user-scoped Facebook and Google integration tables (120 total).

Nonzero BLACOR row counts:

| Table | Rows |
|---|---:|
| brands | 1 |
| setup_sessions | 1 |
| brand_discovery_sessions | 1 |
| brand_knowledge_versions | 16 |
| availability_schedules | 1 |
| content_calendars | 1 |
| ad_creatives | 1 |
| social_posts | 13 |
| ai_usage_log | 12 |
| health_checks | 21 |
| portfolio_health_scores | 1 |
| sage_research_runs | 1 |
| vision_guidance_log | 1 |
| vision_knowledge | 1 |
| vision_study_runs | 1 |

All 13 social posts are `draft`; scheduled and published timestamps are null.
The research/health rows are banked, not represented as proof of provider
publication or ad spend.

BLACOR has **zero** campaigns, social accounts, agent tasks, external actions,
external proofs, and armed publish authorizations.
The owner-wide check since BLACOR's session began also found zero tasks,
external actions, and external proofs, including any brand-null attribution.
These are database footprints, not an independent audit of remote Facebook.

## Cross-reference evidence

The scan examines every selected non-secret column of every BLACOR row in
the brand-scoped tables, recursively including JSON and text. It found no
reference to:

- SDS Page `140006069194366`;
- SDS social account `4ed1a620-18e5-4ed7-84db-d18a6ede340f`;
- SDS destination `https://southdixiestorage.com/`;
- any of the three SDS brand IDs;
- SDS local campaign `5eb4a506-e92e-4d94-a63c-7ce2c15ee741`;
- SDS stored Facebook campaign ID `52548872979134`.

SDS's stored campaign status is `launch_failed`; no live campaign check was
made. BLACOR's session and answers are included in the scan.

Limit: excluded credentials, remote-provider state, and transient browser
memory cannot be certified by this scan. The visible SDS preselection IS
browser state and is intentionally distinguished from a persisted binding.

## Exact source/UI path

1. `EchoAI/controllers/setupAgentController.js:1242–1279` documents the three
   stores, reads BLACOR's ad fields, and returns `missing_ad_destination`
   before campaign launch when either field is absent.
2. `EchoAI/client/src/onboarding/SetupAgent.jsx:1781–1804` renders
   `AdsDestinationCapture`, passing `session.brandId` and
   `onReconnectFacebook={connectFacebook}`. It also renders “Skip this step.”
3. `EchoAI/client/src/onboarding/guided/AdsDestinationCapture.jsx:91–121`
   loads `api.getBrand(bid)` and `api.getFacebookAccounts()`.
   Page candidates are the user's granted list. It runs
   `setPageChoice(curPage || (granted.length === 1 ? granted[0].id : null))`.
   This selects the only Page in browser state; it does not save it.
4. The same component, approximately lines 241–281, renders reconnect only
   in the `pages.length === 0` branch. For exactly one Page it prints
   “This is the only Page on your account — confirm it below.”
   A single radio option cannot be deselected to request another Page.
5. Its Save handler, approximately lines 135–191, validates the input then
   calls `selectFacebookPage(pageChoice, brandId)`, writes the destination,
   and rereads brand truth. These writes do not happen merely from the
   preselection.
6. `EchoAI/controllers/facebookOAuthController.js:418–478` checks only
   granted-Page membership and brand ownership before writing the brand's
   ad Page. It also writes shared `page_ref`. There is no semantic check that
   an SDS-labelled Page is appropriate for BLACOR. The owner must not confirm
   the wrong suggested Page.

### Important side effect on reading the Page list

`facebookOAuthController.js:282–363` implements `GET /api/facebook/accounts`.
Despite being a GET, a connected call can fetch Facebook `/me/accounts`,
merge Page tokens, and UPDATE shared `api_integrations.facebook_pages` and
`facebook_page_tokens`. It falls back to stored Pages if that refresh fails.

Therefore “nothing saved until Save” is true for the brand ad binding, not
literally true for all shared integration state. The investigation avoided
this route and all browser/app visits. The owner screenshot's Page-list load
is consistent with the integration timestamp change, but a timestamp alone
does not prove the exact request that caused it.

## Legitimate recovery path today

The component has a functioning conceptual OAuth callback:
`SetupAgent.connectFacebook()` calls `startFacebookOAuth()` and performs
a full-page handoff. However, that callback is inaccessible from this
one-unrelated-Page gate because its button renders only for zero candidates.
If several correct granted Pages already existed, the list could select one.
That is not the observed state.

No complete owner-visible recovery path exists **on the current paused
second-business gate** to add/select BLACOR's missing Page. We did not certify
every unrelated settings screen as impossible; leaving/skipping and changing
shared OAuth elsewhere is not a tested, safe continuation of this H1 gate.
No reconnect workaround is authorized by this report.

## SDS comparison and no-mutation limits

Reproduced the existing `sds-reproducible-v1` definitions, filters, selected
fields and ordering. Of 22 datasets:

- **20 exact SHA-256 matches**, including SDS brands, all post subsets,
  calendars, tasks/events, external actions/proofs, campaign, creatives,
  spend data, social bindings, Google binding, and publish authorizations.
- `setup_sessions_lifecycle` has one added row: the BLACOR session. Existing
  SDS session rows are unchanged; the definition deliberately includes
  owner-scoped sessions.
- `api_integrations_binding`: only the shared Facebook `updated_at` changed,
  from `2026-08-21T16:50:34.582Z` to `2026-09-10T14:07:08.478Z`.
  All other canonical non-secret values and credential-presence flags match.

The Expected-Events Ledger remains relevant for scheduled lifecycle; no SDS
post/task lifecycle delta needed explaining at this snapshot.
The shared integration timestamp is explicitly reported, not hidden as an
“unchanged” or scheduled-lifecycle event. Its causal attribution is not proven.

Conclusion: no persisted cross-brand binding or SDS business-resource mutation
is evidenced in the compared scope. Do NOT claim the whole shared account was
untouched, that encrypted credential bytes are identical, or that a
point-in-time comparison proves every intervening event.

## Smallest repair surface — proposal only

1. In `AdsDestinationCapture.jsx`, expose “Use/connect a different Facebook
   Page” and an unrelated-Page rejection state when candidates exist too,
   not only when the list is empty. Name the business being configured;
   describe candidates as granted Pages, not all Pages on the owner's account.
2. Keep the gate on the session's exact brand across OAuth return; reload
   candidates and brand truth on return, require an explicit brand-specific
   Page/destination choice, and do not auto-continue or launch.
3. Preserve Store 1/2/3 separation. Do not silently copy `page_ref`, SDS social
   credentials, destination, or another brand's campaign. Do not migrate all
   user-scoped credentials as a side repair. Review shared `page_ref` and
   ad-account side effects before approving any broader workflow.
4. Add focused regression coverage for one unrelated Page, zero/multiple
   Pages, rejected choice, OAuth return, and SDS binding invariance.
5. Separately make the Page-list refresh side effect explicit or provide a
   non-mutating read contract for strict inspection. Do not solve this by
   calling the current GET during read-only certification.

This is a bounded candidate repair, not implementation approval or a claim
that UI edits alone solve every distinct-account requirement.

## Evidence and serialization

- `bank.json`: canonical selected non-secret rows for both businesses.
- `serialization.json`: exact table/column selections, SQL filters, parameters,
  excluded fields, timestamp and sorting rules, and capture timestamp.
- `cross-reference-scan.json` and `supplemental-checks.json`: identity scans.
- `sds-v1-*.json`, `sds-v1-comparison.json`: reproducible historical comparisons.
- `capture.cjs`: capture recipe; evidence only, not application code.
- `source/`: exact reviewed source files and SHA-256 manifest.
- `owner-screen.png`: 1920 × 1080 PNG, 173,978 bytes;
  SHA-256 `364a027ea7ba0452bc21ea30db73962eb42610d2f56008089179deebc2bd8925`.
- `SHA256SUMS`: relative-path checksums for the filed evidence.

No fix, consent simulation, provider call, database write, retry, deployment,
production action, or SDS modification was performed by this investigation.

**HARD STOP — ARCHITECTURAL REPAIR REQUIRED**