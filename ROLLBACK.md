# ROLLBACK.md — Backup, Restore & Rollback Procedure (Zorecho)

**Created:** 2026-07-25 (REPLIT_PROMPT_012 — Backup & Baseline)
**Baseline commit (main, Replit workspace):** `1be389c2df3ce4dfadef78ca3fc2dbe977fc7698`
(the commit immediately after the 2026-07-24 Full System Review Package; contains zero application-code changes since `ae50e8a648f806642f9eb9ab1d7b53a74cf118e4`).

---

## 1. Baseline markers

| Item | Status |
|---|---|
| Git tag `pre-turnaround-baseline` | **BLOCKED in the agent environment** — the Replit agent is prohibited from creating git refs. **James must create it** (see §5). |
| Branch `backup/pre-turnaround` | **BLOCKED for the same reason** — James creates it via the Git panel or GitHub (see §5). |
| Baseline test results | **RECORDED** (see §4). |
| Railway production DB backup | **NOT CAPTURED by the agent** — no Railway access from Replit. James captures it in the Railway dashboard (see §2). |
| Railway staging DB backup | **NOT CAPTURED by the agent** — same reason. |
| Restore drill | **PERFORMED 2026-07-25** against the Replit development database (the only database reachable from this environment). Full evidence in §3. A drill against an actual Railway staging backup remains **UNVERIFIED** until run. |

## 2. Database backup — how to capture (Railway)

The agent has no Railway credentials. James (or anyone with Railway dashboard access) does this:

1. Open the Railway project → the **Postgres service** for **production** (app.zorecho.com).
2. Open the **Backups** tab → **Create backup** (or confirm scheduled backups are ON). Record the backup ID/timestamp here.
3. Repeat for the **staging** Postgres service (staging.zorecho.com).
4. Alternative (manual dump, works from any machine with `pg_dump` and the database's **public** connection URL from Railway → service → Connect):
   ```
   pg_dump -Fc -f zorecho_prod_YYYY-MM-DD.dump "<RAILWAY_PUBLIC_DATABASE_URL>"
   ```
   Store the dump somewhere safe **outside git**. Never commit dump files.

**Backup identifiers (fill in when captured):**
- Production backup: `____________________` (date/ID)
- Staging backup: `____________________` (date/ID)

## 3. Restore drill — procedure + the 2026-07-25 drill evidence

### Procedure (repeat for any backup)

1. Create a scratch database that the application does NOT point at:
   `CREATE DATABASE restore_drill_<date>;`
2. Restore: `pg_restore --no-owner --no-privileges -d "<scratch DB URL>" <backup.dump>`
3. Migration status check — run the app's own runner against the scratch DB; it must report **0 applied** (everything already applied):
   ```
   cd EchoAI && DATABASE_URL="<scratch DB URL>" node -e "require('./utils/runMigrations').runMigrations().then(()=>process.exit(0))"
   ```
4. Sanity counts and compare with the source DB:
   ```sql
   SELECT 'users', count(*) FROM users
   UNION ALL SELECT 'brands', count(*) FROM brands
   UNION ALL SELECT 'campaigns', count(*) FROM campaigns;
   ```
5. Drop the scratch DB when done.

### Drill actually performed (evidence)

- **Who/where/when:** Replit Agent, Replit development environment, **2026-07-25 21:54 UTC**.
- **Source:** the Replit development Postgres (`heliumdb`, PostgreSQL 16.10) — the only DB reachable from this environment. This drill proves the dump→restore→verify procedure and the app's migration check; it does **not** prove Railway's own backup feature (that requires James's drill per §2).
- **Backup:** `pg_dump -Fc` → 3,134,559 bytes, completed in 1.4 s.
- **Restore:** `pg_restore --no-owner --no-privileges` into scratch DB `restore_drill_20260725` — exit code 0, **zero errors**, 7.5 s.
- **Migration status check:** app runner reported `Migrations complete: 0 applied, 130 skipped` → schema fully current. 164 tables present.
- **Sanity counts (restored vs source — identical):**

  | table | restored | source |
  |---|---|---|
  | users | 5 | 5 |
  | brands | 5 | 5 |
  | campaigns | 9 | 9 |

- Scratch DB dropped after verification; dump kept only in `/tmp` (not in git).

## 4. Baseline test results (recorded 2026-07-24/25, Replit dev environment)

- **Server suite** (`cd EchoAI && npm test`): **951 tests, 951 passed, 0 failed**.
- **Client suite** (`cd EchoAI/client && npm test`): **34 files, 385 tests, 385 passed, 0 failed**.
- **Client production build** (`npm run build:client`): succeeded.
- All three re-ran green in the automated validation on 2026-07-25 at commit `1be389c2`.

## 5. Code rollback procedure

The agent cannot push; all git-remote operations are done by James.

**Create the baseline markers (one time, do now):**
1. Push current work: Replit **Git panel → Push** (gets `1be389c2` onto GitHub `main`).
2. On GitHub (`19JRB71/EchoAI-Foundation`): open the repo → Releases → **Draft a new release** → tag `pre-turnaround-baseline` targeting `main` (this creates the tag), or from any machine: `git tag pre-turnaround-baseline && git push origin pre-turnaround-baseline`.
3. Create branch `backup/pre-turnaround` from `main` (GitHub → branch dropdown → type the name → "Create branch from main").

**Roll production code back to the baseline:**
1. GitHub → `main` → **Revert** the offending merge/commits (preferred — keeps history), or reset `main` to `pre-turnaround-baseline` (destructive; only if reverting is impractical).
2. Railway auto-deploys `main` → production. Watch the deploy logs; the boot runs `npm run start:prod` (migrate → build → start).
3. **Important:** SQL migrations are forward-only. If a bad migration already ran in production, code rollback alone does NOT undo it — restore the DB from the pre-change Railway backup (§2/§3) or write a corrective migration.

**Roll the database back:**
1. Railway → Postgres service → Backups → **Restore** the chosen backup (Railway restores in place), or restore a manual dump per §3 into a fresh DB and repoint `DATABASE_URL`.
2. After any DB restore, verify with the §3 migration check + sanity counts before letting traffic in.

## 6. Rules

- Never commit database dumps, `.env` files, or backup archives to git.
- A backup that has never been restored is a hope, not a backup — re-run the §3 drill after any major schema change and record it here.
- The restore target must never be a database the live app points at.
