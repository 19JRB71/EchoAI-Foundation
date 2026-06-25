---
name: Wiring a standalone app into the artifact preview
description: How a non-artifact standalone app (EchoAI) is made visible in this workspace's path-based preview/proxy
---

# Standalone app preview wiring

This workspace's preview/canvas only renders apps registered with the path-based
proxy (each artifact's `.replit-artifact/artifact.toml` declares `paths`).
A standalone app placed at the repo root (outside `artifacts/`) runs fine but is
**invisible in the preview** — the proxy returns 404 for every unregistered path,
which shows up as a blank screen / "couldn't reach this app".

**The fix used:** serve the standalone app single-origin (one Express server
serves both the built SPA and `/api/*`), then repurpose an existing, unused
artifact's `artifact.toml` to point at it (`previewPath = "/"`, one `[[services]]`
with `paths = ["/"]`, and `development.run` starting the app).

**Why single-origin:** if the app's API path (`/api`) is owned by a *different*
artifact, the shared proxy routes `/api` to that other artifact, not your app.
Making one artifact own `/` and serve `/api` itself sidesteps the collision.

## Gotchas (cost real attempts)

- **`verifyAndReplaceArtifactToml` cannot change an artifact's `kind`.** Repurpose
  an artifact whose existing `kind` already renders the preview you want. `kind = "api"`
  still renders a browser preview here. To get `kind = "web"` you'd have to
  `createArtifact` a fresh one.
- **`development.run` executes from the artifact directory, not the repo root.**
  Use an absolute path: `cd /home/runner/workspace/<app> && npm start`. A bare
  `cd <app>` fails with "No such file or directory".
- **Editing the toml does not kill the old service cleanly.** The previous
  process can keep holding the port (EADDRINUSE) and make the restart fail. Free
  the port (`fuser -k <port>/tcp`) before restarting the artifact workflow.
- The `Project` run-button wrapper workflow is not removable via `removeWorkflow`
  (only the individual workflows are).
