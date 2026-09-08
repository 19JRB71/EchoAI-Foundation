# 026-C3-PM9b — Staging Deployment Failure Investigation

**Investigation date:** 2026-09-08 America/New_York  
**Authority:** Existing PM9b merge deployment investigation only  
**Verdict:** **HARD STOP — SAFE SAME-SHA REDEPLOY IS NOT AVAILABLE**

## 1. Executive result

The exact approved PM9b head remains:

```text
d688b960a91e24a2570355f415aedb8363423361
```

Remote `staging` remains at the already-created merge:

```text
a3fa570a8d5bc255b469aaca2c8246d325ae9a86
```

Railway detected that exact merge and created a deployment. The deployment was
not missing, queued, or attached to another Git head: GitHub recorded Railway
deployment `6275791381` for the exact merge SHA and later recorded:

```text
context:     calm-purpose - prolific-perception
state:       failure
description: Deployment failed
updated_at:  2026-09-05T01:44:51Z
```

The corresponding deployment status became `failure` at
`2026-09-05T01:44:54Z`. The previous healthy staging release remained live.

No staging redeploy was triggered during this investigation. No application code,
deployment configuration, Git SHA, BLACOR/SDS state, provider state, or production
environment was changed.

## 2. Final live staging identity

Read-only live checks returned:

```text
health environment:    staging
health SHA:            57261ebe59248c555c3eccb02bdcaa9a6d69f8eb
served bundle:         index-B3EZDk_P.js
served bundle SHA-256: 10734b4b942aa20347597c4ca3d036b68151cef5fcdb6c03fc0b26ef71245e37
served service worker: echoai-shell-v185
applied migrations:    148
```

Required but not live:

```text
health SHA:            a3fa570a8d5bc255b469aaca2c8246d325ae9a86
served bundle:         index-qsmk6fKo.js
served bundle SHA-256: 3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
served service worker: echoai-shell-v186
```

## 3. Branch, repository, and trigger findings

| Question | Finding |
|---|---|
| Does the repair branch still point to the approved head? | Yes, exact match |
| Does remote `staging` point to the merge SHA? | Yes, exact match |
| Did Railway detect the merge? | Yes, deployment created for the exact merge |
| Was no deployment triggered? | No; a deployment was triggered |
| Is the deployment queued/stuck? | No; it reached terminal `failure` |
| Is the failed deployment tied to another Git SHA? | No; it is tied to the exact merge |
| Did PM9b alter Railway config or dependency manifests? | No |

The merge changed only the PM9b client/test/evidence files and regenerated client
distribution files. It did not change either Railway configuration, Nixpacks
configuration, `EchoAI/package.json`, or `EchoAI/yarn.lock`.

The following blobs are byte-identical between the last live base
`57261ebe59248c555c3eccb02bdcaa9a6d69f8eb` and failed merge
`a3fa570a8d5bc255b469aaca2c8246d325ae9a86`:

```text
railway.toml
EchoAI/railway.toml
EchoAI/nixpacks.toml
DEPLOYMENT_RAILWAY.md
EchoAI/package.json
EchoAI/yarn.lock
```

Therefore this was not a PM9b deployment-configuration change or dependency
manifest change.

## 4. Railway log-access result

The GitHub deployment record exposes only the terminal Railway status and Railway
deployment URL. The public Railway page did not expose build or deploy log lines.

A Railway MCP connection was authorized specifically to inspect the private logs
and use the normal same-SHA redeploy control. The Railway MCP server then failed
to become reachable and mounted no callable Railway tools. Consequently:

- no private build/deploy log was retrievable;
- no authenticated Railway redeploy control was available; and
- the exact provider log line that terminated the build cannot be certified in
  this checkpoint.

The investigation does not invent a provider log or claim an unobserved error
message.

## 5. Concrete deployment-input defect

The Railway service's `EchoAI/nixpacks.toml` runs:

```text
yarn install --production=false --non-interactive --network-concurrency 1
  --ignore-engines --frozen-lockfile
```

The exact committed `EchoAI/yarn.lock` contains **26** package resolutions under
the Replit-internal host:

```text
http://package-firewall.replit.local/npm/...
```

Examples include Puppeteer/browser packages, WebSocket packages, Zod, and Yarn
CLI dependencies. Railway runs outside Replit and cannot safely rely on resolving
the private `package-firewall.replit.local` hostname.

The lockfile blob is identical in the last live base and failed merge. This means:

- PM9b did not introduce the bad resolutions;
- an earlier Railway build could have succeeded from a warm dependency/build
  cache; and
- a cache-cold or cache-miss build can attempt the non-portable URLs and fail
  before producing a deployable image.

This defect is fully observed in the exact deployment input and is consistent
with the terminal failure. Because the private Railway log is unavailable, this
report does **not** overstate it as a confirmed quote from the failed build.

## 6. Redeploy safety decision

An unchanged-SHA retry was not performed.

Retrying would be unsafe and non-deterministic because:

1. the failed provider log is unavailable, so no transient condition is proven;
2. the exact frozen lockfile still contains 26 Railway-unresolvable URLs;
3. a retry would depend on undocumented cache state rather than a corrected,
   reproducible deployment input; and
4. the authorization explicitly requires stopping when safe redeploy needs a
   code/configuration change.

A deterministic retry requires separate authorization to replace the internal
lockfile resolutions with public registry URLs, validate the resulting frozen
lockfile/build, and deploy a newly reviewed commit. This investigation did not
perform that change.

## 7. BLACOR boundary

Because the approved PM9b release never became live, the clean BLACOR pre-flight
was not reopened as an owner-ready gate. The existing filed read-only capture
remains the latest tenant-state evidence:

```text
BLACOR application state: zero
SDS unpublished hash:
  fe8af88e061af2c7e2c3f3504dba9b96ccadde9c938c6edd67dc42f858ecb27b
SDS scheduled hash:
  d4eb12ff4699ae2105fc91246131061281f3c15290655f886fac06128dd20ec9
PAUSED/$0 boundary: intact
```

No BLACOR session, brand, task, content, campaign, action, or proof was created.
No SDS row was changed. No Retry, spend, scheduling, publishing, Meta request, or
other provider call occurred. BLACOR-H1 was not started.

## 8. Final verdict

**HARD STOP — SAFE SAME-SHA REDEPLOY IS NOT AVAILABLE**

Exact blocker:

```text
Railway detected and failed deployment of the exact staging merge. Its private
build logs and redeploy control are unavailable because the authorized Railway
MCP server is unreachable, while the exact frozen yarn.lock still contains 26
Replit-internal package URLs that are not portable to Railway. Without a
separately authorized lockfile correction or authenticated evidence proving a
transient provider failure, retriggering the unchanged SHA is not safe.
```

**Evidence files:**

```text
review_package/docs/026-C3-PM9b_STAGING_DEPLOYMENT_FAILURE_INVESTIGATION.md
review_package/docs/026-C3-PM9b_BLACOR_PRE_FLIGHT_RERUN_REPORT.md
```