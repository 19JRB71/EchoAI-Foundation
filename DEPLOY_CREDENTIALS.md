# DEPLOY_CREDENTIALS — Standing GitHub deploy credential (I-25)

**Status:** ACTIVE (pending first token entry — see Current Token below)
**Approved:** Prompt 015 Stage-2 authorization (D-22), 2026-07-30. Replaces the
per-prompt temporary PAT practice used through Prompts 004–005.

## What this credential is

A single **fine-grained GitHub Personal Access Token**, stored only in the
Replit secret `GITHUB_PUSH_TOKEN`, used by the agent to push feature branches
and open PRs against the deploy repository. It is never committed, printed,
or stored anywhere else.

## Required scope (mint EXACTLY this — nothing more)

| Setting | Value |
|---|---|
| Token type | Fine-grained personal access token |
| Resource owner | `19JRB71` |
| Repository access | **Only select repositories → `19JRB71/EchoAI-Foundation`** |
| Permission: Contents | **Read and write** |
| Permission: Pull requests | **Read and write** |
| All other permissions | No access |
| Expiration | **90 days** |

Worst-case exposure with this scope: contents of one repository. The token
cannot touch other repos, org/account settings, secrets, workflows, or
deployments.

## Current token

| Field | Value |
|---|---|
| Minted | 2026-07-30 |
| Expires | **2026-10-28** (GitHub emails a warning ~7 days prior) |
| Stored in | Replit secret `GITHUB_PUSH_TOKEN` |

> Update this table at every rotation. Each End-of-Prompt report must state
> the current expiry date (Stage-2 authorization, term: sequence clause).

## Rotation checklist (~2 minutes, quarterly)

1. GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → **Generate new token** with the exact scope table
   above (or use "Regenerate" on the existing token).
2. Copy the new token once.
3. Replit → Secrets → edit `GITHUB_PUSH_TOKEN` → paste the new value → save.
4. Delete the old token on GitHub (skip if it was regenerated in place).
5. Update the **Current token** table above (minted + expiry dates).
6. Ask the agent to verify: a read-only `git ls-remote` against the repo
   confirms the new token works without pushing anything.

## Emergency revocation

- GitHub side: Settings → Developer settings → Fine-grained tokens → Delete.
- Or ask the agent: GitHub's credential-revocation API
  (`POST https://api.github.com/credentials/revoke`) kills the token
  immediately — used successfully on 2026-07-30.

## Rules

- Never mint a broader-scoped or non-expiring token for this purpose.
- Never paste the token in chat; only enter it in the Replit Secrets pane.
- The agent must never `git branch`/`git tag` from the shell (lockfile trap);
  push flow is fetch → temp-index → commit-tree → push SHA to a new remote ref.
