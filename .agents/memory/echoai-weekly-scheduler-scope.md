---
name: EchoAI weekly scheduler brand scope
description: Why the Monday weekly run only iterates active-campaign brands, and where on-demand fills the gap
---

The Monday `runWeeklyAnalytics()` loop selects brands via `brands JOIN campaigns WHERE c.status='active'`. Every weekly job (analytics, auto-optimize, creative-perf, weekly report email, feedback report, Advanced ROI snapshot, Customer Intelligence) runs inside this single loop, so a brand with no active campaign gets none of them automatically.

**Why:** This is intentional, not a bug. Intelligence/ROI synthesize the fresh output of the earlier jobs, which only exist for active brands; auto-generating for fully dormant brands wastes AI calls and yields low-quality briefs. Enterprise owners who paused campaigns but still run SMS/email/phone can still hit the on-demand "Generate now" endpoint (works for any owned brand).

**How to apply:** Do not "fix" intelligence/ROI to iterate all brands separately — that would diverge from the established pipeline. If auto-coverage for campaign-less brands is ever truly required, change the brand-selection for the *whole* loop consistently, not one job.

## Rule: run-now must resolve the weekly-claim conflict honestly
**Why:** the batch claim is UNIQUE(brand_id, week_start), so a failed weekly
batch used to block run-now forever (the UI's advertised "retry" 409'd), and
owners couldn't start mid-week content without waiting for Monday.
**How to apply:** on weekly-claim conflict branch on the LATEST batch:
generating→409 wait; failed→atomic reclaim (status-guarded UPDATE) + wipe items
+ regenerate in place; ready with pending items→409 finish review (getCurrentBatch
shows only the latest batch — a newer one would hide pending items); else claim
an EXTRA batch keyed on today's date (once/day). Monday cron path unchanged.
