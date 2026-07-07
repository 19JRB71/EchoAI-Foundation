---
name: EchoAI admin diagnostic report
description: Design rules for the admin Full Diagnostic Report endpoint (account self-scan across subsystems).
---

# EchoAI Full Diagnostic Report

Admin-only endpoint that scans the calling admin/owner's OWN account (brands +
account-level subsystems) and returns a single copyable plain-text report plus a
prioritized top-10 fixes list. Lives in the Admin panel as a "Diagnostics" tab.

**Scope rule:** it is an account self-scan (`brands WHERE user_id = req.user.userId`
+ account-level integrations/quota/team/subscription), NOT a platform-wide scan.
The Admin panel already has "Platform health" for the all-accounts view — don't
conflate the two. Account can own multiple brands → brand-level sections iterate
per brand, account-level sections render once.

**Why rule-based, not AI:** the top-10 prioritization is deterministic (severity
rank → slice 10), with NO Anthropic/OpenAI call. A diagnostic that fails when the
AI providers are down is useless — this is the whole point of the tool. Do not
"upgrade" it to AI-generated insights without keeping a working non-AI path.

**Honest-failure invariant:** every subsystem read is wrapped so one broken table
can't blank the report, BUT a caught read error must be surfaced ("DATA READ
ERRORS" section + a HIGH issue), never rendered as "no data". Silent "no data" on a
failed read falsely implies healthy — that violates EchoAI's no-silent-fallback
rule. If you add a new scanned subsystem, add its query to the per-brand/account
`noteErr(...)` list too.

**No migration:** it is pure read-only aggregation over existing tables — adding a
persistence table would be scope creep (and would collide with the drizzle
post-merge push landmine that wants to drop non-drizzle tables).
