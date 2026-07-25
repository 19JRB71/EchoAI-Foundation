---
name: Blocked git ref attempts leave stale lock files
description: Why the Replit Git panel shows INDEX_LOCKED after the agent tries to create a tag/branch
---

Rule: never attempt `git tag` / `git branch` creation from the agent shell — the platform blocks it AND leaves a stale lock file behind (e.g. `.git/refs/tags/<name>.lock`), which later breaks the user's Git panel with an INDEX_LOCKED error.

**Why:** Observed July 2026 — a blocked `git tag pre-turnaround-baseline` left `.git/refs/tags/pre-turnaround-baseline.lock`; the user's Push failed until the lock was deleted. `find .git -name "*.lock"` finds all culprits, not just `.git/index.lock`.

**How to apply:** Refs must be created by the user on GitHub (branch dropdown / release-tag flow). If the Git panel errors with INDEX_LOCKED, sweep and delete `.git/**/*.lock`, then have the user retry Push.
