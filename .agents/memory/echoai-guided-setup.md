---
name: EchoAI guided setup
description: How the per-section setup guide + Echo setup reminders are structured and the invariants to keep.
---

- One server-side source of truth computes setup status per feature by probing REAL account state; probe failures report status "unknown" — never fabricate done/incomplete.
- The client renders the guide from ONE injection point in the dashboard shell (keyed by section→feature map) — never per-section copies; overview/missioncontrol get the aggregate progress card with tier-gated nav jumps.
- Echo's briefing reminder uses a never-throws top-incomplete helper and mentions exactly ONE unfinished setup per briefing (gentle single sentence), including on the empty/new-account branch.
- **Why:** honesty rule (no invented status), and multiple nudges per briefing would feel naggy for a non-technical owner.
- **How to apply:** any new subsystem with setup steps gets a catalog entry (steps + real DB probes) — the section banner, overview card, and Echo reminder all pick it up automatically.
