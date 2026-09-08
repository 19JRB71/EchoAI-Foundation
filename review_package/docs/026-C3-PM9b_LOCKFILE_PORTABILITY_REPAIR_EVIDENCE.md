# 026-C3-PM9b — Lockfile Portability Repair Evidence

**Evidence date:** 2026-09-08 America/New_York  
**Authority:** Lockfile portability repair and pre-merge packaging only  
**Verdict:** READY FOR CLAUDE PRE-MERGE — PORTABILITY REPAIR

## 1. Scope and causation boundary

This package proves that the repository portability defect in `EchoAI/yarn.lock`
was repaired without changing dependency identity or application behavior.

It does **not** prove that the portability defect caused the previous Railway
failure. The private Railway build log was unavailable, so that causal claim
remains a hypothesis.

No merge, staging deployment, production deployment, BLACOR-H1 action, provider
call, Retry, scheduling, publishing, or spend action was performed.

## 2. Pinned base

Implementation began from a fresh detached checkout of current remote `staging`.

```text
expected parent: a3fa570a8d5bc255b469aaca2c8246d325ae9a86
observed remote: a3fa570a8d5bc255b469aaca2c8246d325ae9a86
base tree:       5080cd8a061cf8f57af2c4c98cb40f967b0c4d2a
base lock blob:  a096395cf7d00d1b0c25760b46ad431c056dcce6
```

The long-lived workspace was not used as implementation authority.

## 3. Exact repair

Exactly 26 existing `resolved` fields changed:

```text
old prefix: http://package-firewall.replit.local/npm/
new prefix: https://registry.npmjs.org/
```

The package path and tarball filename after the old `/npm/` prefix are unchanged.
No lockfile regeneration or dependency resolution command was used to make the
edit.

Lockfile hand-edit numstat:

```text
insertions: 26
deletions:  26
touched:    52
ceiling:    120
```

### Exact affected selectors

| # | Lock selector | Version | Portable tarball |
|---:|---|---:|---|
| 1 | `@puppeteer/browsers@3.0.6` | `3.0.6` | `https://registry.npmjs.org/@puppeteer/browsers/-/browsers-3.0.6.tgz` |
| 2 | `ansi-regex@^6.2.2` | `6.2.2` | `https://registry.npmjs.org/ansi-regex/-/ansi-regex-6.2.2.tgz` |
| 3 | `ansi-styles@^6.2.1` | `6.2.3` | `https://registry.npmjs.org/ansi-styles/-/ansi-styles-6.2.3.tgz` |
| 4 | `chromium-bidi@17.0.2` | `17.0.2` | `https://registry.npmjs.org/chromium-bidi/-/chromium-bidi-17.0.2.tgz` |
| 5 | `cliui@^9.0.1` | `9.0.1` | `https://registry.npmjs.org/cliui/-/cliui-9.0.1.tgz` |
| 6 | `devtools-protocol@*, devtools-protocol@0.0.1653615` | `0.0.1653615` | `https://registry.npmjs.org/devtools-protocol/-/devtools-protocol-0.0.1653615.tgz` |
| 7 | `emoji-regex@^10.3.0` | `10.6.0` | `https://registry.npmjs.org/emoji-regex/-/emoji-regex-10.6.0.tgz` |
| 8 | `escalade@^3.1.1` | `3.2.0` | `https://registry.npmjs.org/escalade/-/escalade-3.2.0.tgz` |
| 9 | `get-caller-file@^2.0.5` | `2.0.5` | `https://registry.npmjs.org/get-caller-file/-/get-caller-file-2.0.5.tgz` |
| 10 | `get-east-asian-width@^1.0.0, get-east-asian-width@^1.5.0` | `1.6.0` | `https://registry.npmjs.org/get-east-asian-width/-/get-east-asian-width-1.6.0.tgz` |
| 11 | `mitt@^3.0.1` | `3.0.1` | `https://registry.npmjs.org/mitt/-/mitt-3.0.1.tgz` |
| 12 | `modern-tar@^0.7.6` | `0.7.7` | `https://registry.npmjs.org/modern-tar/-/modern-tar-0.7.7.tgz` |
| 13 | `puppeteer-core@*` | `25.4.0` | `https://registry.npmjs.org/puppeteer-core/-/puppeteer-core-25.4.0.tgz` |
| 14 | `string-width@^7.0.0` | `7.2.0` | `https://registry.npmjs.org/string-width/-/string-width-7.2.0.tgz` |
| 15 | `string-width@^7.2.0` | `7.2.0` | `https://registry.npmjs.org/string-width/-/string-width-7.2.0.tgz` |
| 16 | `string-width@^8.2.1` | `8.2.2` | `https://registry.npmjs.org/string-width/-/string-width-8.2.2.tgz` |
| 17 | `strip-ansi@^7.1.0` | `7.2.0` | `https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz` |
| 18 | `strip-ansi@^7.1.2` | `7.2.0` | `https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz` |
| 19 | `typed-query-selector@^2.12.2` | `2.12.2` | `https://registry.npmjs.org/typed-query-selector/-/typed-query-selector-2.12.2.tgz` |
| 20 | `webdriver-bidi-protocol@0.4.2` | `0.4.2` | `https://registry.npmjs.org/webdriver-bidi-protocol/-/webdriver-bidi-protocol-0.4.2.tgz` |
| 21 | `wrap-ansi@^9.0.0` | `9.0.2` | `https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-9.0.2.tgz` |
| 22 | `ws@^8.18.0, ws@^8.21.1` | `8.21.1` | `https://registry.npmjs.org/ws/-/ws-8.21.1.tgz` |
| 23 | `y18n@^5.0.5` | `5.0.8` | `https://registry.npmjs.org/y18n/-/y18n-5.0.8.tgz` |
| 24 | `yargs-parser@^22.0.0` | `22.0.0` | `https://registry.npmjs.org/yargs-parser/-/yargs-parser-22.0.0.tgz` |
| 25 | `yargs@^18.0.0` | `18.1.0` | `https://registry.npmjs.org/yargs/-/yargs-18.1.0.tgz` |
| 26 | `zod@^3.23.8, zod@^3.24.1, zod@^3.25.0 \|\| ^4.0.0` | `3.25.76` | `https://registry.npmjs.org/zod/-/zod-3.25.76.tgz` |

## 4. Dependency-identity preservation

Before/after lockfile SHA-256:

```text
before: f2d29b7a87d41b3388683e995b07d7b7c847817eb3a1ea4670fafaf3eac50da5
after:  fee4be35c58f01d630b48eb909038a879bfaffde45e659e26b1809fc8eb80bc
```

All 302 version records are byte-identical:

```text
base version-lines SHA-256: e7d6b0ba4d0ed15306dbbcbaf4916f08f7f3ee0cd0b73ec2555b726e93c3a6e5
new version-lines SHA-256:  e7d6b0ba4d0ed15306dbbcbaf4916f08f7f3ee0cd0b73ec2555b726e93c3a6e5
```

All 302 integrity records are byte-identical:

```text
base integrity-lines SHA-256: 790e756ebf2d8da3f4b1c70ad3f38f77cd87da012c46ce4df2f5293b29804686
new integrity-lines SHA-256:  790e756ebf2d8da3f4b1c70ad3f38f77cd87da012c46ce4df2f5293b29804686
```

All package names, selectors, dependency relationships, and package manifests
are byte-identical to the pinned base.

## 5. Permanent host-policy scan

The complete lockfile scan returned:

```text
package-firewall.replit.local occurrences: 0
other non-registry package hosts:           0
https://registry.npmjs.org resolutions:     302
```

Standing one-line scan:

```text
review_package/evidence/026-C3-PM9b-lockfile-portability/lockfile-host-scan.txt
```

## 6. Cache-cold frozen install

Environment and semantics:

```text
fresh checkout:             yes
preexisting node_modules:   0
package cache entries:      0
Node:                       v24.13.0
Yarn:                       1.22.22
production flag:            false
network concurrency:        1
ignore engines:             yes
frozen lockfile:            yes
```

Command:

```text
YARN_CACHE_FOLDER=<empty-cache> yarn install \
  --production=false \
  --non-interactive \
  --network-concurrency 1 \
  --ignore-engines \
  --frozen-lockfile
```

Result:

```text
Resolving packages: passed
Fetching packages:  passed
Integrity checks:   passed
Linking:            passed
Fresh builds:       passed
Install result:     PASS
lock before:        fee4be35c58f01d630b48eb909038a879bfaffde45e659e26b1809fc8eb80bc
lock after:         fee4be35c58f01d630b48eb909038a879bfaffde45e659e26b1809fc8eb80bc
lock unchanged:     yes
```

Host-scrubbed log:

```text
path:   review_package/evidence/026-C3-PM9b-lockfile-portability/cache-cold-yarn-install.log
SHA-256: 149c832bd63e57c186f6a28f81f4b1e6e40cb2b8c035591aea80e3064551e85d
internal-host occurrences in log: 0
```

## 7. Production build and artifact identity

The direct `cd client && npm run build` attempt correctly exposed that the
non-private root Yarn workspace did not install the client `vite` executable.
It changed no tracked file.

The repository's standing production client command was then run with an empty
npm cache:

```text
npm run build:client
```

That command performs the pinned client install and Vite production build.
`client/package-lock.json` and every package manifest remained byte-identical.

Result:

```text
bundle:                  index-qsmk6fKo.js
bundle SHA-256:          3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
expected SHA-256:        3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
service worker:          echoai-shell-v186
generated dist status:   CLEAN
fingerprint protocol:    not required; exact approved artifact reproduced
```

Build log:

```text
path:    review_package/evidence/026-C3-PM9b-lockfile-portability/production-client-build.log
SHA-256: f22ff659e6adc6595184c4e9b01ca1da650a29e16744dcb740b105d94aaf17f1
```

## 8. Required regression proof

| Suite | Result | Evidence log | SHA-256 |
|---|---:|---|---|
| PM9b focused client | 9/9 | `pm9b-focused-client.log` | `cdc97aed81f021fc09db0c9735dcddf927a9bd8762a905b9955e0d68cf89f751` |
| PM9 client preservation | 10/10 | `pm9-client-preservation.log` | `c1ff6bde0c88cee2e994741e7b3039f2f6f3388a7960933384e5c32f7765644a` |
| PM9 server preservation | 34/34 | `pm9-server-preservation.log` | `c3b48dfa35b8b757a7cadafab001a4cf6c8d391e41f751609020c451ed2168e5` |
| Full server | 1534/1534 | `full-server-suite.log` | `4f3be2d898f1e0aea080e0a00834fdfdd3b8cd5bad471fe99155c33b3baddc77` |
| Full client | 518/518 | `full-client-suite.log` | `506f13e4324e10640bd44f66ddd04a0ec2dadc16dbd068bf0881eb7839e88bdb` |

All paths above are under:

```text
review_package/evidence/026-C3-PM9b-lockfile-portability/
```

Full-suite arithmetic:

```text
server:   1534 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo
client:   518 passed, 0 failed
combined: 2052 passed, 0 failed
```

The isolated test database setup log is:

```text
path:    review_package/evidence/026-C3-PM9b-lockfile-portability/test-db-setup.log
SHA-256: 745e78cfc7c4a82008f886ae542dee7c9f89f234adc5b315a67bfc45ef3035f5
```

## 9. Schema and byte-integrity proof

Migration inventory:

```text
schema.sql:          1
numbered migrations: 147
total:               148
```

Git byte-diff against pinned base is empty for:

```text
EchoAI/client/src
EchoAI/config
EchoAI/controllers
EchoAI/routes
EchoAI/utils
EchoAI/models
EchoAI/server.js
all package.json files
all package-lock.json files
EchoAI/client/dist
```

The PM9b implementation and test blobs are unchanged. `SetupAgent.jsx` is:

```text
base blob:    14a43be4897657a3ab3bb1c21714ee94f5a77e07
current blob: 14a43be4897657a3ab3bb1c21714ee94f5a77e07
```

The only tracked `EchoAI/` delta is:

```text
EchoAI/yarn.lock
```

## 10. Evidence-file hashes and numstat

| File | Insertions | Deletions | SHA-256 |
|---|---:|---:|---|
| `EchoAI/yarn.lock` | 26 | 26 | `feee4be35c58f01d630b48eb909038a879bfaffde45e659e26b1809fc8eb80bc` |
| `cache-cold-yarn-install.log` | 26 | 0 | `149c832bd63e57c186f6a28f81f4b1e6e40cb2b8c035591aea80e3064551e85d` |
| `full-client-suite.log` | 767 | 0 | `506f13e4324e10640bd44f66ddd04a0ec2dadc16dbd068bf0881eb7839e88bdb` |
| `full-server-suite.log` | 2681 | 0 | `4f3be2d898f1e0aea080e0a00834fdfdd3b8cd5bad471fe99155c33b3baddc77` |
| `pm9b-focused-client.log` | 11 | 0 | `cdc97aed81f021fc09db0c9735dcddf927a9bd8762a905b9955e0d68cf89f751` |
| `pm9-client-preservation.log` | 13 | 0 | `c1ff6bde0c88cee2e994741e7b3039f2f6f3388a7960933384e5c32f7765644a` |
| `pm9-server-preservation.log` | 56 | 0 | `c3b48dfa35b8b757a7cadafab001a4cf6c8d391e41f751609020c451ed2168e5` |
| `production-client-build.log` | 139 | 0 | `f22ff659e6adc6595184c4e9b01ca1da650a29e16744dcb740b105d94aaf17f1` |
| `test-db-setup.log` | 153 | 0 | `745e78cfc7c4a82008f886ae542dee7c9f89f234adc5b315a67bfc45ef3035f5` |
| `lockfile-host-scan.txt` | 1 | 0 | `2f02e0908de1ac1e6944ec636e75af5f7d7873aac86a34f5834a246a8826cce2` |
| `026-C3-PM9b_LOCKFILE_PORTABILITY_REPAIR_EVIDENCE.md` | 314 | 0 | self-hash intentionally returned after commit |

## 11. Safety boundary

Confirmed:

- BLACOR-H1 was not started.
- BLACOR state was not read or mutated.
- SDS state was not read or mutated.
- No provider or Meta request was made.
- No content was scheduled or published.
- No Retry or spend action occurred.
- Production was not touched.
- Remote `staging` was not changed.
- No merge or deployment was performed.

## 12. Pre-merge verdict

**READY FOR CLAUDE PRE-MERGE — PORTABILITY REPAIR**

The repair branch is a review package only. Stop for Claude review; do not merge
or deploy.