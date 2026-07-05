---
name: EchoAI owner-profile write semantics
description: Two distinct write paths for the Echo owner profile — authoritative overwrite vs AI-learned merge — must stay separate.
---

# EchoAI owner-profile write semantics

The Echo owner profile (`echo_owner_profile`) has **two** write paths that must
NOT share merge logic:

- **Manual owner edit** (PUT /api/echo/owner-profile → `setOwnerProfileRow`) is
  AUTHORITATIVE: the submitted values *are* the profile. An empty string CLEARS
  that column to NULL, so the owner can correct/remove anything Echo got wrong.
- **AI-learned capture** (`captureFromConversation` → `mergeOwnerProfileRow`) is a
  MERGE: only non-empty incoming values overwrite; a field Echo simply didn't
  mention this turn is preserved (never blanked).

**Why:** an early version routed the manual-edit controller through the AI merge
helper, so owners could never clear a field — the merge dropped empties. The two
intents (owner overwrite vs Echo augment) are genuinely different and both are
needed.

**How to apply:** any new owner-profile writer must pick the right base:
`writeOwnerProfileRow` writes exactly-as-given (column keys, empties→NULL);
`setOwnerProfileRow` maps app keys→columns for authoritative edits;
`mergeOwnerProfileRow` for learned augmentation only.
