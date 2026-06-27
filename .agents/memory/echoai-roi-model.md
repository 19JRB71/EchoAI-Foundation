---
name: EchoAI ROI model
description: How the Customer ROI Dashboard derives value/hours/money figures and why they are transparent estimates.
---

# ROI computation model

The ROI Dashboard (`/api/roi`) computes value from **real platform activity**
(leads, campaigns, social_posts, email_sends, analytics) multiplied by
**industry-average constants** kept in `config/roiModel.js` (lead value, hot-lead
value, hourly labor rate, hours-per-task, reach-per-post, etc.).

**Rule:** the value/hours/money numbers are *estimates*, not measured truth. The
controller always returns the full `assumptions` object in the payload, and the
client shows a "value figures use industry-average estimates…" disclaimer.

**Why:** the no-mocked-data principle means activity counts must be real, but
monetary value of a lead / an hour saved is inherently modeled — so it must be
labeled as such and the multipliers must stay inspectable, not hidden.

**How to apply:** if asked to change ROI numbers, edit the constants in
`config/roiModel.js` (single source of truth, used by both `computeRoi` and
`computeAndStoreHistory`). Don't hardcode multipliers in the controller. Keep the
disclaimer + `assumptions` passthrough intact.

The 12-week history is recomputed from real weekly aggregates on every
`GET /:brandId/history` call and **upserted** into `roi_snapshots`
(`ON CONFLICT (brand_id, week_date)`), so the table always mirrors latest data
rather than being an append-only log.
