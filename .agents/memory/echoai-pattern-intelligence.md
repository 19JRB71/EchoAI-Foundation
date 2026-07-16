---
name: EchoAI Sage Pattern Intelligence (PIE)
description: Design rules for the industry pattern-study engine and its Forge steering
---

- **Prevalence, never engagement.** Meta Ad Library exposes no engagement metrics or media — PIE aggregates only what-share-of-ads-use-a-pattern counts (pure code, `aggregateAnalyses`). Any "top performing" framing would be fabrication.
- **Industry-wide, never per-competitor.** Ad Library search uses the industry term itself as `search_terms`; studying named competitors belongs to Competitor Ad Spy, not PIE.
- **Zero-sample honesty.** A report built with sampleSize=0 must be grounded in web-search citations or the AI response is rejected (`aiInvalid` → 502). No token → `fetchIndustryAds` returns `[]`, never throws or fabricates.
- **Forge steering is soft bias.** Sage's `forge_brief` recommendation gets a ×3 weight in `pickValue`, but exploration and recency blocking still apply — never a lock-in; guidance lines always include the never-imitate rule.
- **Run claims.** Weekly job claims per ISO week (`weekly:YYYY-Wnn`) in `sage_research_runs` cycle_type `patterns`. Manual refresh claims at MINUTE granularity and 409s when unclaimed — the unique index is the only concurrency gate, so the run key granularity IS the rate limit.
- **`brand.industry` lives on `users`**, joined in by `getOwnedBrand`/`activeBrandsForSage` — a bare `brands` row has no industry column.

**Why:** honesty invariants (no fabricated metrics) and originality (study patterns, never copy competitors) are spec-level product commitments; the architect review caught that an unclaimed manual run still executed.

**How to apply:** any new Sage study cycle should reuse the claimRun/finishRun seam and gate execution on the claim result; any new aggregate must be a real count over stored analyses.
