---
name: EchoAI weekly scheduler brand scope
description: Why the Monday weekly run only iterates active-campaign brands, and where on-demand fills the gap
---

The Monday `runWeeklyAnalytics()` loop selects brands via `brands JOIN campaigns WHERE c.status='active'`. Every weekly job (analytics, auto-optimize, creative-perf, weekly report email, feedback report, Advanced ROI snapshot, Customer Intelligence) runs inside this single loop, so a brand with no active campaign gets none of them automatically.

**Why:** This is intentional, not a bug. Intelligence/ROI synthesize the fresh output of the earlier jobs, which only exist for active brands; auto-generating for fully dormant brands wastes AI calls and yields low-quality briefs. Enterprise owners who paused campaigns but still run SMS/email/phone can still hit the on-demand "Generate now" endpoint (works for any owned brand).

**How to apply:** Do not "fix" intelligence/ROI to iterate all brands separately — that would diverge from the established pipeline. If auto-coverage for campaign-less brands is ever truly required, change the brand-selection for the *whole* loop consistently, not one job.
