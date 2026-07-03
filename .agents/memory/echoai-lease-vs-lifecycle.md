---
name: EchoAI lease vs lifecycle guard
description: Lease-holding writers must still status-guard terminal writes; sibling lifecycle endpoints mutate status out-of-band.
---

# Lease serializes writers against writers, NOT against out-of-band status changes

A renewable execution lease (the setup-agent `/execute` lease) only stops two
*executors* from running a step at once. It does **not** stop sibling lifecycle
endpoints (`/pause`, `/dismiss`) from flipping `status` (and dismiss revoking
consent) with a plain UPDATE that never consults the lease.

**Rule:** every write an in-flight leased handler makes to the shared row —
especially the terminal `status='completed'` finalize and any progress
(`completed_steps`) write — must be guarded on the current lifecycle status
(`WHERE ... AND status='in_progress'`). When the guarded UPDATE matches 0 rows,
back off and report the row's real state (409 + current session), never fabricate
success.

**Why:** without the guard, a `/dismiss` (or `/pause`) that commits mid-step is
silently clobbered — the classic corruption is a *dismissed* session being
resurrected to *completed* by the finalize UPDATE, or a cancelled run still
recording progress. `requireSetupConsent` only reads status at request start, so
it leaves a TOCTOU window (read in_progress → dismiss commits → handler finalizes
on the stale snapshot); the status guard on the write is what actually closes it.

**How to apply:** any time you add a background/leased writer AND a separate
endpoint that can change the same row's lifecycle state, status-guard the writer's
UPDATEs. Side effects already performed stay idempotent (existence checks), so the
only thing that must be protected is the row's lifecycle coherence.
