---
name: EchoAI grid 1fr min-content clipping
description: CSS grid 1fr tracks won't shrink below content min width — with overflow-hidden this silently clips one side at narrower viewports.
---

The rule: in CSS grid, `1fr` means `minmax(auto, 1fr)` — the track refuses to
shrink below its content's min-content width. Inside an `overflow-hidden`
container the grid then silently overflows and the LAST column gets clipped,
while the first column looks fine (grid lays out left→right), so the bug looks
asymmetric and only appears at laptop/tablet widths.

**Why:** The Mission Control V2 Core hero (`grid-cols-[1fr_auto_1fr]`, fixed
~432px center) clipped the right-side agent chips at 1366px and 1024px
viewports even though desktop looked perfect and all tests passed — screenshots
at multiple viewports were the only thing that caught it.

**How to apply:** For side columns that must yield to a fixed center, use
`minmax(0,1fr)` (Tailwind: `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`) and
make sure inner text has `min-w-0` + `truncate`. When verifying responsive
claims, capture at ~1024 and ~1366 too, not just the wide desktop viewport —
`/tmp/shots/capture_vp.js` style parameterized capture works well.
