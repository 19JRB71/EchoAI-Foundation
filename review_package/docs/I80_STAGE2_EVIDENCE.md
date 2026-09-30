# I-80 Stage 2 — pre-finalization evidence (fresh-clone working tree)

**Exact baseline source SHA:** `de8e996f55fd5139a5488f75f7d96078f9dc25c6` (`HEAD` of the approved fresh public GitHub clone of `19JRB71/EchoAI-Foundation`). The production and test working tree is now frozen for this evidence snapshot. This is **not a merged or deployed release**. The native Git PAT was rejected; public read/clone succeeded; an installed GitHub API path is available to the parent for packaging. Authenticated push remains **PENDING**; recovery merge gate **UNVERIFIED**. No merge, deployment, live provider/OAuth traffic, or live SDS/BLACOR database interaction is certified by this document. This documentation task made no commit.

## Architectural anchor map (source inspection, not a live proof)

| Authority / path | Concrete source anchor and boundary |
|---|---|
| Store 1: grant, not destination | `controllers/facebookOAuthController.js` `initiateOAuth` requires owner and scoped `brandId`/`sessionId`/`authorizationId`, stores 10-minute OAuth session state; `oauthCallback` verifies state/context and updates `api_integrations.facebook_pages` and encrypted tokens, with `selectedPageRef = null`. An incomplete Page fetch errors rather than writing a partial snapshot. `getConnectedAccounts` returns granted candidates with `unavailable` and `boundBusinessName`; `selectedPageId = null`, not `page_ref` as a default. |
| Cross-business exclusion | `utils/onboardingFirstWin.js` `lockFacebookBindings` takes transaction advisory lock `8042080`; `facebookBindings` checks existing Store 2 and Store 3 page IDs across brands; `validateFacebookDestination` checks owner, collision, connected grant and exact Page token. Unreadable Store 2 account binding errors instead of permitting inferred identity. |
| Store 2: sole C1 writer | `controllers/socialController.js` `setFacebookBrandPage` → `confirmFacebookBrandPage` requires explicit `confirm_business_facebook_page`, owner, brand, Page, scope, lock and grant validation. Inserts `social_accounts` Facebook Page identity with encrypted `{pageId}` only, not a copied token. Bound OAuth callback may call this same helper *only* with an exact destination authorization. Destination-null callback redirects pending for a picker; `connectSocialAccount` rejects generic Facebook writes. `disconnectSocialAccount` checks owner/active publishing under the lock. |
| Armed first win | `utils/onboardingFirstWin.js` `claimArmedAuthorization` requires exact user/brand/authorization and confirmed Page, checks prepared post, 7-day window, content hash and Page, then claims and schedules in one transaction; `confirmFacebookBrandPage` calls it within its C1 transaction. `facebookOAuthController.js` invokes a publisher sweep only after `firstWin.claimed`; unbound authorization cannot schedule. |
| Store 3: dedicated C3 writer | `controllers/facebookOAuthController.js` `selectPage` requires `confirm_ads_destination`, owned `brandId`, Page and normalized `adLinkUrl` (or explicit removal with current Page), takes same lock and validates grant/collision; updates **only** `brands.facebook_page_id` and `brands.ad_link_url`, not `social_accounts` or `api_integrations.page_ref`. `brandController.js` rejects generic brand-update attempts at Page/link fields. |
| Consumers and UI | `socialController.js` resolves a publish/reverify token from the exact grant and C1 Page binding and rejects cross-brand collision; `reputationController.js` reads that brand's bound Page instead of Graph `pages[0]`. `client/src/sections/social/ConnectedAccounts.jsx` requires explicit available Page selection (`selectionOnly` for Setup Agent); `SetupAgent.jsx` carries scoped return context and calls C1; guided `AdsDestinationCapture.jsx` is shared by guided wizard and Setup Agent pause, requires an explicit C3 save/removal, and rereads brand truth before declaring success. `client/src/api.js` carries context/consent through existing routes. Hosts `ConnectionsStep.jsx` and `FacebookWizard.jsx` remain byte-identical to base. |

## Regression-to-anchor map (test source; individual green status requires final runner review)

`EchoAI/tests/i80.facebookBoundary.test.js` is **new/untracked** and exercises isolated PostgreSQL fixtures through real HTTP/auth/controllers, with stubbed Graph/provider calls: H wrong-brand `pages[0]` callback cannot bind/schedule/publish; H singleton/GET/status/skip zero-write; H OAuth context/nonce mismatch and replay; H exact-bound callback and missing grant; H same-owner/cross-owner collision and concurrent C1/C3 serialization; H grant loss and legacy inline-token rejection; H prior consent vs no-consent and real team-member remapping. R-S3a/b/c tests generic-write rejection, C3 write/removal, three-store separation; R-REPa/b/c tests reputation Page, unbound and foreign brand isolation. **These fixture tests are not evidence of a live provider or SDS traversal.** Final parent scope accounting: **712 production lines = 548 server + 164 client; 776 test lines = 542 server + 234 client**. These are scope tallies, **not** test-case counts.

`client/src/onboarding/SetupAgent.pm8.test.jsx` covers pending callback context, wrong-business return, 0/1/2 candidate Page selection, occupied Page disabling, C1-only explicit confirmation and selection-only behavior. `client/src/onboarding/guided/AdsDestinationCapture.test.jsx` covers 0/1/many Pages, website suggestion without implicit write, R-C3a consented save/readback, R-C3b change, R-C3c cancellation/confirmed removal, R-C3d failed removal readback; retains PM3 account-vs-verify and PM4 normalized authoritative readback regressions. Existing `client/src/onboarding/SetupAgent.test.jsx` covers OAuth launch/retry and setup recovery. `tests/onboardingFirstWin.test.js` tests null-context/no-binding, exact consent, expiry/content drift, atomic rollback and concurrency. Modified `test/facebookUnified.test.js`, `test/facebookAccountsContract.test.js`, `test/socialMediaUpload.test.js`, `test/socialReverify.test.js`, `test/setupAgent.owneraction.test.js`, `test/deliveryCrons.test.js`, `tests/externalProofs.test.js`, `tests/taskSpine.test.js`, and `tests/tenantIsolation.background.test.js` are regression/fixture adaptations. Standing D32 fixtures/mocks in older tests remain and are disclosed, not treated as live external verification.

## Current evidence and gate status

| Evidence | Current observation / limit |
|---|---|
| `/tmp/i80-server-final-full.log` → `review_package/evidence/I80_STAGE2_server-final-full.txt` | **1547/1547 passed**, zero failures/skips, `duration_ms 96811.434373`. Copied file SHA-256 `0e86ed4a9030dfb7b9de12b1dc93b4115b6e480306394a9019eb9feec8417663`. |
| `/tmp/i80-client-final-full.log` → `review_package/evidence/I80_STAGE2_client-final-full.txt` | 53 files, **535/535 passed**, zero failures. Copied file SHA-256 `7b72366622694b19c8eecad299107efd451fc1351a57a1859b3f86b2b87f0c0b`. |
| Combined final regression total | **2082/2082 passed = 1547 server + 535 client**; baseline **2052** at approved source SHA above; change **+30 = +13 server +17 client** (baseline/delta reported by parent; baseline was not separately rerun in this task). |
| `/tmp/i80-client-final-build.log` → `review_package/evidence/I80_STAGE2_client-final-build.txt` | Vite reports `built in 7.53s`, generated `dist/assets/index-Bjm_z3-E.js`; copied file SHA-256 `2ebd51a694d0e2d1ae61c0800eb681ac85f1586bef7c9d6f213ddc522431ccb8`. Not a deployment. |
| `/tmp/i80-db-setup.log` → `review_package/evidence/I80_STAGE2_db-setup.txt` | Isolated test DB setup reports **148 migrations applied, 0 skipped**; copied file SHA-256 `8186b159f31af4116616151aa10495f3143720a8ab51a09190cce865e51b1e45`. This does not imply a fresh live DB check or migration in production. |

Final tests used isolated test fixtures and a sanitized test environment (server preload `tests/dbGuard.js` and stubbed Graph/providers in I-80 HTTP regression tests); the server log warns live Facebook and Hermes credentials are not set. The logged runs are local automated regressions, **not** current live-provider, staging-deployment or SDS certifications. Copied evidence uses `.txt` because the environment globally ignores `*.log`; old intermediate log copies were removed.
| Banked SDS (historical only) | `exports/blacor-r1-staging-pin/hash-manifest.json` labels `sds-v1-brands.json` SHA-256 `e4681c8abdc8799aaf7c931639edd587cbcb004935a4cd4ddb156a06d3a95ea8`; `sds-v1-social_accounts_binding.json` and other exact bank datasets are indexed there. `exports/blacor-r1-staging-pin/sds-v1-comparison.json` is a **prior comparison**, not a fresh Stage 2 live recertification. Its `social_posts_all` old/new hash differs due to banked expected events; do not claim all datasets identical. No fresh SDS query was made here. |

## Mechanical bundle and byte identity

`client/public/sw.js` and `client/dist/sw.js` both declare `echoai-shell-v187`; both SHA-256 `6de475bdc29d089431f6e5446043d2daecbab05a399ff18dfb40208bde6c8d1c`. Final dist `index.html` SHA-256 `9492cf7ab80437e34a4632c0af9e432b93ad8b7f510d9058bf9f925d2c0c7cf7`; final JS `dist/assets/index-Bjm_z3-E.js` SHA-256 `a880460c24901af88278a278df79ac4f136dd084a0f753a5f42a5cd7ff41e578`; dist CSS `dist/assets/index-BOSvCscE.css` SHA-256 `98648c1a9dd8503141088b067acf16985161fe85dc0753dc7d779e11b48a9db1`. These four dist fingerprints and public SW are also recorded in `review_package/evidence/I80_STAGE2_LOCAL_DIST_SHA256SUMS.txt`. Previous tracked `index-qsmk6fKo.js` deleted; new JS is untracked until parent adds it. Dist CSS retained from base (not changed in this diff). These are local artifacts, not live fingerprint/rollout claims.

`git diff --quiet HEAD -- EchoAI/routes EchoAI/models EchoAI/package.json EchoAI/client/package.json package.json pnpm-lock.yaml pnpm-workspace.yaml EchoAI/client/src/onboarding/guided/ConnectionsStep.jsx EchoAI/client/src/components/FacebookWizard.jsx` returned zero. Representative base-equal SHA-256: `routes/facebookOAuthRoutes.js` `e3152c33889bce9f43bed467ef8c7da2846068ecd2d27862b265562290530994`; `models/140_onboarding_first_win.sql` `4a62315bfcccd60123b91377f280ad94ab9d9258c15e9be52bca0521ace8d9c7`; `models/127_brand_ad_destination.sql` `aad58620aa52a50fc70415266f49a7f0ef93fbd353d21bfe84041ba19eeb5632`; `EchoAI/package.json` `28e4c29d1228d596563c8d9aad92ada254b2d4c5a60453621ad5e09a0e628401`; `EchoAI/client/package.json` `95db0cd67027e34fbeafb2b32fbd9f09b472e159a0fffff6b72f2b332c53f246`; root `package.json` `cb46b9a7cf36c3948f010715aef141b4b98dd7f65c7e3379553a78834c147439`; `pnpm-lock.yaml` `1c40abdf73bed07010e8472177469e2a1f65a585aba98626851dee50aaee8167`; hosts `ConnectionsStep.jsx` `5ad4bc37914f49da61720194e7be83a76a55e06f8d9cf1bd3ee255a88a2d7e39`, `FacebookWizard.jsx` `6cfd5b73394272141e21d352834e0edfc6bb2677cd4184c594f8109b803fe478`. No changed routes, migrations, packages or host files were seen.

### D32 sentinel comparison against **this** base, not the old 41-MATCH claim

Using the file paths in `SENTINELS.md`'s original D32 table, all other listed paths are unchanged against `de8e996f`; the **three evolved** files are `EchoAI/tests/externalProofs.test.js` (Git blob `5a719c12` → `c64e3566`: fixture now supplies exact Store 1 Page/token and Store 2 Page identity), `EchoAI/tests/taskSpine.test.js` (`40f6d96a` → `ecdbb673`: fixture now supplies the same Store 1/2 prerequisites), and `EchoAI/tests/tenantIsolation.background.test.js` (`7cf011e3` → `5116410c`: explicit Store 2 Page plus current Store 1 grant replaces legacy embedded-token bypass). These are modified *tests*, not unchanged sentinels; stubbed provider behavior in these tests is not live recertification. In particular `utils/facebookApi.js`, `utils/campaignVerification.js`, `utils/taskSpine.js`, `utils/adLaunchSpine.js`, `utils/emailSendSpine.js`, `utils/executeExternal.js`, `utils/scheduler.js`, `tests/dbGuard.js`, the P010 artifacts, FCM config and migrations 125–134 compare byte-identically to base. The old `SENTINELS.md` statement “41 MATCH” concerns an earlier audited commit, **not** this unmerged Stage 2 tree. A full post-merge audit and test gate are PENDING.

### Working-tree numstat snapshot (tracked files; added/deleted lines)

| Path (under `EchoAI/`) | + | − |
|---|---:|---:|
| client/dist/assets/index-qsmk6fKo.js (deleted) | 0 | 154 |
| client/dist/index.html | 1 | 1 |
| client/dist/sw.js | 1 | 1 |
| client/public/sw.js | 1 | 1 |
| client/src/api.js | 7 | 7 |
| client/src/onboarding/SetupAgent.jsx | 29 | 3 |
| client/src/onboarding/SetupAgent.pm8.test.jsx | 82 | 3 |
| client/src/onboarding/SetupAgent.test.jsx | 18 | 1 |
| client/src/onboarding/guided/AdsDestinationCapture.jsx | 55 | 38 |
| client/src/onboarding/guided/AdsDestinationCapture.test.jsx | 104 | 26 |
| client/src/sections/social/ConnectedAccounts.jsx | 12 | 13 |
| controllers/brandController.js | 4 | 0 |
| controllers/facebookOAuthController.js | 71 | 118 |
| controllers/reputationController.js | 9 | 30 |
| controllers/socialController.js | 105 | 65 |
| test/deliveryCrons.test.js | 8 | 1 |
| test/facebookAccountsContract.test.js | 5 | 1 |
| test/facebookUnified.test.js | 24 | 7 |
| test/setupAgent.owneraction.test.js | 8 | 8 |
| test/socialMediaUpload.test.js | 6 | 0 |
| test/socialReverify.test.js | 6 | 0 |
| tests/externalProofs.test.js | 7 | 1 |
| tests/onboardingFirstWin.test.js | 54 | 30 |
| tests/taskSpine.test.js | 6 | 1 |
| tests/tenantIsolation.background.test.js | 11 | 4 |
| utils/onboardingFirstWin.js | 96 | 50 |

**Untracked, absent from `git diff --numstat` until added:** `EchoAI/client/dist/assets/index-Bjm_z3-E.js`, `EchoAI/tests/i80.facebookBoundary.test.js`, this document, `review_package/evidence/I80_STAGE2_LOCAL_DIST_SHA256SUMS.txt`, and the **four final `.txt` evidence logs** listed above. All final `.txt` evidence files are visible to normal `git ls-files --others --exclude-standard` (unlike ignored `.log` paths). These frozen-source numstat counts should be reconciled once more by the parent immediately before Git Data API packaging. No commits, pushes or production edits were made by this documentation task.