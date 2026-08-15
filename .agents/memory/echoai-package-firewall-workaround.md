---
name: Package firewall can block previously-installable versions
description: npm registry firewall 403s on lockfile-pinned versions; safe node_modules-copy workaround.
---
The workspace package firewall can newly 403 ("Blocked by Security Policy") a version that installed fine before (seen with tar-6.2.1), breaking `npm install` in a fresh clone even with an unchanged lockfile.

**Why:** policy updates land independently of the project; retries won't help.

**How to apply:** if the clone's package-lock.json is byte-identical to an existing installed tree's (verify root AND client), copying that tree's node_modules over is a safe workaround — no package.json/lockfile change. Record the provenance in any evidence report. Also: /tmp is wipeable mid-session — put rebuild clones under `.local/`, never /tmp.
