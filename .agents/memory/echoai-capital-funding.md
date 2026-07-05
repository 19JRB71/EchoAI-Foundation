---
name: EchoAI Capital & Funding (Scout)
description: Enterprise Scout subsystem — funding scan, opportunity briefing, grant writer, funding pipeline; scheduler-wired.
---

- Scout's Capital & Funding is an Enterprise subsystem mounted at `/api/capital`, backed by three tables (funding_opportunities, grant_applications, opportunity_briefings). It closely mirrors the customerIntelligence pattern (weekDateFor Monday-UTC, ON CONFLICT upsert, sendError→502, getOwnedBrand).

- **Structured deadline vs cadence text.** funding_opportunities has BOTH `deadline DATE` and `deadline_text`. The AI returns an ISO date ONLY when certain (honesty rule: never invent deadlines); `parseIsoDate` in fundingIntelligencePrompt collapses cadence strings / bad dates to null. The pipeline "upcoming deadlines" view filters `deadline IS NOT NULL` — so it ONLY populates from concrete dates, and `deadline_text` ("Rolling", "Annual (verify)") is display-only. If you persist opportunities without writing `deadline`, the deadline tracker is silently dead.
  **Why:** the initial build wrote only deadline_text; the pipeline query needs the DATE column, so upcomingDeadlines was always empty until a real `deadline` was added end-to-end (prompt schema + validate + INSERT).
  **How to apply:** any new time-bounded opportunity source must feed the DATE column, keeping cadence in the text field.

- **Status preservation on rescan (dismissed stays dismissed).** The weekly funding upsert deliberately does NOT set `status` in its ON CONFLICT DO UPDATE, so an owner-dismissed program isn't resurrected. Grant drafts are one-per-opportunity (partial UNIQUE on opportunity_id); re-drafting replaces summary/sections but preserves owner-managed status/notes.
