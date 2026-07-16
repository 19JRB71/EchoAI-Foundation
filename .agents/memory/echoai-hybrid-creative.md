---
name: EchoAI Hybrid Creative Engine
description: Creative mode rules for Autopilot graphics — asset/assisted/ai modes, honesty invariants, permission gating.
---

Autopilot/Forge graphics carry a per-item creative mode: `asset` (owner photo, enhancement-only), `assisted` (owner photo + explicitly permitted AI edits), `ai` (original concept).

**Rules:**
- Mode decisions live in one pure engine (utils/creativeModes.js); controllers never re-derive shares or permissions inline.
- `ai` mode output must NEVER pretend to depict the owner's real product/work — an originality line is injected into every AI-mode prompt.
- `asset` mode ignores broader permissions: enhancement keys only, even if the owner allowed background swaps etc. `assisted` appears only when at least one non-enhancement permission is on.
- "Only my media" + empty photo library must fail honestly (batch: skip with owner-visible reason; instant post: 201 + explicit notice, never a quiet AI image presented as a photo).
- If a chosen source photo file is missing at render time, downgrade to `ai` AND persist the mode flip so the badge shown to the owner stays truthful.
- Ads are always `ai` mode by design.

**Why:** the platform-wide honesty rule — never fabricate that AI output is the customer's real work — is the invariant customers rebrand on; a silent fallback here misrepresents their product publicly.

**How to apply:** any new content-generation path that can start from a Vision reference photo must route through decideModes/editDirectives and preserve the persist-on-downgrade behavior.
