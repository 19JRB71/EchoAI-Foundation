---
name: EchoAI workspace vs GitHub staging drift
description: The dev workspace tree is not authoritative; real staging lives on GitHub. How to build a compliant audit surface.
---

**Rule:** The Replit workspace `EchoAI/` tree can be far behind real staging (found 168 files divergent; verified staging SHA absent from local git history). Any code citation, file:line evidence, or D-37 test count for owner reports MUST come from a fresh clone of `https://github.com/19JRB71/EchoAI-Foundation` branch `staging` (use `$GITHUB_PUSH_TOKEN` in the URL), cloned into /tmp — never from the workspace tree or its local git remotes (they are gitsafe/subrepl mirrors, no usable origin).

**Why:** Prompt-035 Stage 1 nearly shipped a field audit made against stale workspace code that lacked the Prompt-011/022/023/024 substrate entirely.

**How to apply:** clone to /tmp, checkout the verified SHA, and if `npm ci` is blocked by the package firewall: confirm `package-lock.json` (server AND client) is byte-identical to the workspace's, then `cp -r` (NOT `cp -al` — /tmp is a different device, hardlinks fail silently) the workspace `node_modules` trees into the clone and run the suites there. Cite the clone HEAD SHA next to the numbers.
