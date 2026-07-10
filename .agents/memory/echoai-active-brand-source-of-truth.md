---
name: EchoAI active-brand single source of truth
description: App.jsx selectedBrandId is authoritative for the active brand; brand-scoped panels must take it as a prop, never hold their own copy.
---

# The active brand has one source of truth

`App.jsx` `selectedBrandId` (the dashboard "Viewing Business" switcher, `BrandBar`)
is the **single source of truth** for which brand is currently active. `""` = the
all/unselected state (also the initial value before brands load), which maps to a
brand selector's "All businesses" option.

Any panel or overlay that needs brand context (e.g. the floating Echo chat panel
`EchoCompanion`) **must receive `selectedBrandId` as a prop and mirror it** (a
`useEffect` that sets its local brand state from the prop). It must **not** hold
its own independently-initialized brand copy.

**Why:** `EchoCompanion` used to keep its own `activeBrandId` (initialized once
from `getEchoState()` and only changeable via its own in-panel dropdown) and was
rendered with no brand props. Switching brand tabs on the dashboard did not update
it, so the panel header — and the brand Echo scoped its answers to — could show a
different brand than the dashboard ("cross-brand contamination": Echo answered a
Facebook-connection question using the wrong brand's data).

**How to apply:**
- Pass `selectedBrandId` (and `setSelectedBrandId` as `onSelectBrand`) down to the
  panel; sync local state from the prop via `useEffect`.
- If the panel keeps its own selector, wire its `onChange` to `onSelectBrand` so
  the dashboard and panel stay in lockstep (bidirectional), never diverge.
- Do not re-initialize the panel's brand from the server after mount — the prop is
  authoritative.
