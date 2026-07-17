# ZORECHO SAGE DEPARTMENT — FULL CAPABILITY AUDIT
**Date:** July 17, 2026 · **Method:** direct code inspection (routes, controllers, prompts, migrations, scheduler, client UI, tests). No code was modified. Anything not provable from code is labeled **Not verified** or **Does not exist**.

---

## 1. Sage's claimed role — promises vs implementation

| Where the claim lives | Claim | Status |
|---|---|---|
| `client/src/lib/departments.js` | "Industry Intelligence Agent… report on exactly who your company is — reviewed and approved by you before any department uses it" | **Implemented** (Company Truth, owner-approval gated) |
| `client/src/sections/Sage.jsx` | "Sage continuously researches the live web… trends, competitor moves, opportunities and threats" | **Implemented** (Anthropic `web_search`, 6-hour deep cycle) — but the 30-min urgent scan is **switched off by default** (`SAGE_URGENT_ENABLED=false`) |
| `prompts/sagePrompt.js` system prompt | "Never falls back to made-up data… refuses any brief that isn't backed by real citations" | **Enforced in code** — citation check throws 502 when no sources returned |
| Guided Setup copy | Sage "standing by… we'll focus on growing it" | Accurate for research; Sage does not "grow" anything itself |
| `SUBSYSTEMS.md` | Self-review "studies the past week's REAL platform data… recommendation-only" | **Implemented** as described |

**Honest gaps between the brand promise ("strategy brain") and the code:** Sage today is an *evidence gatherer and report writer*, not a strategy/measurement brain. There is **no** opportunity-ranking engine, no experiment system, no forecasting, no strategy lifecycle, and no closed loop from recommendation → execution → measured result (details in §10–§15, §23).

---

## 2. Current Sage architecture (complete map)

**Routes** (mounted in `server.js`): `/api/sage` (`routes/sageRoutes.js` → `controllers/sageController.js`), `/api/company-truth` (`companyTruthController.js`), `/api/admin/self-review` (`selfReviewAdminController.js`), plus adjacent intelligence systems: `/api/intelligence` (`customerIntelligenceController.js`), `/api/competitor-ads` (`competitorAdSpyController.js` — Scout), `/api/competitor-sites` (`competitorSiteController.js`).

**Scheduled jobs** (`utils/scheduler.js`, gated by AI-controls flags):

| Job | Frequency | Gate | Function | Status |
|---|---|---|---|---|
| sage-deep-cycle | every 6 h | `SAGE_RESEARCH_ENABLED` | `runSageDeepCycle` → brief + feed | **Fully working** |
| sage-urgent-scan | every 30 min | `SAGE_URGENT_ENABLED` (**off by default**) | `runSageUrgentScan` → urgent feed + owner page | Working but **dormant** |
| sage-pattern-study | weekly Mon 04:00 | `SAGE_RESEARCH_ENABLED` | `runSagePatternStudy` (Pattern Intelligence) | **Fully working** |
| self-review | Mon 07:15 | admin AI controls | `utils/selfReview.js` | **Fully working**, admin-only |
| weekly-analytics stack | Mon 08:00 | `WEEKLY_AI_STACK_ENABLED` | includes `generateWeeklyIntelligence` (Customer Intelligence) | Working, Enterprise-gated |
| competitor ad spy | every 6 h / daily 05:45 | Enterprise + Scout | `competitorAdSpyController` | Working (no FB token → honest no-op) |
| site monitor | daily 04:00 (20 h recheck) | — | `competitorSiteController` | Working |

**Storage tables** (migrations `069_sage_industry_intelligence.sql`, `101/102` feed dedup, `109_sage_pattern_intelligence.sql`, `111/114_company_truth`, `095_self_review.sql`, `039_customer_intelligence.sql`, `007_competitor_intelligence.sql`): `sage_intelligence_profiles`, `sage_intelligence_feed`, `sage_competitors`, `sage_research_runs` (atomic claim ledger), `sage_pattern_campaigns`, `sage_pattern_insights`, `company_truth_reports`, `self_review` tables, `customer_intelligence`, `competitor_ads`, `competitor_ad_reports`, `competitor_websites`, `competitor_website_changes`.

**Classification summary:**
- Fully working: Company Truth, Industry Brief (deep cycle), Sage Feed, Competitor Watch, Pattern Intelligence, Intelligence Input, Self-Review, Ad Spy, Site Monitor, Customer Intelligence.
- Dormant by config: urgent scan, parts of the Monday AI stack.
- Placeholder/UI-only: none found — every Sage tab is wired to a real backend.
- **Missing entirely** (claimed by the "brain" vision, not by the UI): opportunity engine, strategy engine, experiments, forecasting, attribution beyond campaign-level, closed learning loop on Sage's own recommendations.

---

## 3. Company Truth audit

Gathering: `gatherCompanyData` (`utils/companyTruth.js`) + `generateCompanyReport` (`prompts/companyTruthPrompt.js`, Anthropic + `web_search` up to 4 uses, max_tokens 8192).

| Source | Exists? | How gathered | Notes |
|---|---|---|---|
| Website URL + content | **Yes** | `brands.website_url`; content via `web_search` (not direct scraping) | |
| Facebook Page | **Yes** | `brands.facebook_page_url` + web_search | |
| Instagram / LinkedIn / YouTube / TikTok | **No dedicated fields** — only whatever `api_integrations` shows connected | Not researched individually |
| Google Business Profile | **Not gathered** | | |
| Address / service area | Partial — `geo_targeting` on brand; serviceArea section inferred from research | Not verified against a structured address field |
| Products/services, pricing, target customer, brand voice | **Yes** — brand columns + discovery session `draft_profile` + research | |
| Brand colors/assets | Partial — `vision_reference_images` labels/counts only | |
| Current offers | **Not a structured input** (may appear in research prose) | |
| Customer reviews | **Yes** — `reviews` table: count, avg rating, 5 latest excerpts | |
| FAQs / business hours / sales process | **Not gathered** | |
| Competitors | **Yes** — up to 15 confirmed `sage_competitors` | |
| Past campaigns / marketing activity | **Yes** — social post + campaign counts | Counts only, not performance |
| Customer objections / CRM conversation history | **No** — only the onboarding discovery conversation | Lead/autonomous-conversation history NOT fed in |
| Uploaded files | Partial — photo labels, not document contents | |
| Goals / capacity | **Not gathered** (goals exist in `060_target_goals.sql` but are not an input) | |
| Owner approval | **Yes** — hard lifecycle gate | |

**Structure & honesty:** fully structured JSON (17 sections incl. `classification`, `excludedCategories`, `missingInformation`), schema-validated (`validateCompanyReport`), **versioned** (`version` column; `generating → pending_approval → approved → superseded`, `failed` added in migration 114), owner edits tracked in `edit_log`, re-research notes in `research_request`. Missing data goes into `missingInformation` — the prompt prohibits invention.

**Critical finding:** `getApprovedCompanyTruth(brandId)` is the designed gatekeeper, but **almost no other department currently calls it** — consumers found are the Sage UI tab and tests. The "reviewed and approved before any department uses it" promise is architected but **not yet wired into Nova/Atlas/Forge/Pulse prompt contexts**. This is the single biggest promise/implementation gap.

---

## 4. Source & evidence standards

Sources actually used: Anthropic `web_search` (industry, competitors, company research), `web_fetch` (submitted links, competitor sites, FB pages), Meta Ad Library API (Ad Spy + Pattern Intelligence), owner-submitted links/images/PDFs (Intelligence Input), internal DB (reviews, campaigns, leads counts).

Evidence stored per finding:

| Field | Brief | Feed | Ad Spy | Site Monitor | Pattern Intel |
|---|---|---|---|---|---|
| Source URL | Yes (`sources` JSONB) | Yes (`url`) | Yes (snapshot link) | Yes | Ads referenced |
| Date | Yes | Yes | Yes (delivery start) | Yes | Yes |
| Confidence score | **No** | **No** | **No** | **No** | **No** |
| Evidence excerpt | Yes | Yes | Yes (ad copy) | Yes (details JSONB) | Yes |
| Geographic relevance | Prose only | Prose only | No | No | No |
| Verification status | No | No | N/A (primary source) | N/A | N/A |

Fabrication risk areas: citation enforcement exists for the brief and pattern study (no citations → 502). The **weekly ad-intelligence report** (`competitor_ad_reports`) stores prose recommendations **without** per-claim source links — lowest-evidence output in the Sage family. Confidence scoring does not exist anywhere.

---

## 5. Competitor Watch

- **Selection:** manual add (`POST /api/sage/competitors`) + AI suggestion of 3–6 direct competitors via web_search (`sagePrompt.js` ~line 390); suggested → owner **confirms** → only confirmed competitors feed Ad Spy / monitoring. No notion of indirect/aspirational competitors, agencies, or new-entrant detection.
- **Gathered per competitor:** website, FB page, follower counts, last-post recency, ad activity summary, strategy summary (`sage_competitors`). Site Monitor additionally diffs website snapshots for pricing/offer/messaging/product/CTA/redesign changes (`competitor_website_changes`), ignoring cosmetic changes, with immediate alerts + weekly digest.
- **Ad Spy (Scout, Enterprise):** live FB Ad Library ads for confirmed competitors — headline, body, CTA, platforms, start date; Hermes classifies threat; aggressive new ad → one-time voice+SMS alert (atomic CAS); Monday report with longevity-based "top ads" + exactly 3 recommendations.
- **Not gathered:** pricing signals as structured data, review sentiment/velocity of competitors, hiring activity, guarantees/financing, geographic expansion, response speed. **Does not exist.**
- **Role:** evidence-gathering + prose recommendations. The one autonomous action in all of Sage: `applySageGeoExclusions` (`sageController.js` ~line 325) auto-applies state-level geo exclusions on legal/regulatory findings.

## 6. Market Watch / Industry Brief

Real web-grounded system, not a template generator: `deepResearch` (`sagePrompt.js`) with up to 6 web searches, citation-enforced, refreshed 6-hourly, structured into 7 narrative sections + marketing insights + sources (`sage_intelligence_profiles`). Monitors: industry trends, consumer behavior, competitive landscape, regulation/legal, opportunities. **Does not monitor:** search behavior data, weather, interest rates/economics, labor/supply, local development, seasonality as structured signals — anything of that kind appears only if web search happens to surface it. Relevance is steered by brand industry/audience but there is no per-brand feedback ("this was useless") loop except feed dismissal.

## 7. Customer Intelligence

`/api/intelligence` (Enterprise, weekly). Actually synthesizes internal platform data across campaigns, leads (temperature/status), calls, SMS, email open/click, social engagement, appointments, feedback sentiment, competitor intel, ROI snapshots, SEO, ad creatives → Trajectory Score (1–10), executive analysis, 5 ranked recommendations, trends (`customer_intelligence` table). **Missing:** objections/lost-deal/no-show reasons as structured data, price sensitivity, buying timeline, repeat/referral behavior, best-customer profiling, salesperson feedback — none of these are captured anywhere in the schema, so they cannot be analyzed. **Does not exist.**

## 8. Channel Intelligence

Channels with real data: Facebook ads (Insights API — spend, clicks, impressions, CTR, actions, ROAS), Facebook/Instagram organic (post engagement), email (open/click), SMS (delivery/replies), chatbot/website leads, SEO content activity, reviews. **No data:** Google Ads performance (OAuth reads exist but Google integration currently disabled by env), Google LSA/GBP, YouTube, TikTok, LinkedIn, marketplaces, direct mail, referrals, partnerships, events, influencers, PR, offline. There is **no per-channel evaluation matrix**; channel comparison happens only implicitly inside weekly Customer Intelligence prose.

## 9. Pattern Intelligence

Exists (`utils/patternIntelligence.js`, `prompts/patternIntelligencePrompt.js`, weekly job, tables `sage_pattern_campaigns` / `sage_pattern_insights`). Consumes **real Meta Ad Library ad text industry-wide** (not per-competitor), aggregates deterministically, then Claude distills hook types, emotions, value-speed, copy traits. Honesty built in: prompt explicitly states it has **no engagement metrics** and reports *prevalence* ("what advertisers keep paying for") — it does not claim causation. Output: insights (pattern/evidence/why) + a **Forge-ready creative brief** (consumed by Forge).
**Gap vs the ideal:** it analyzes only external ads. It does **not** consume Company Truth, Nova results, Atlas performance, Pulse lead movement, Voice outcomes, your own creative performance, seasonality, geography, funnel drop-offs, or offer performance. There is no cross-source pattern engine. **Does not exist.**

## 10. Opportunity Engine — **Does not exist**

The closest artifacts: `marketing_insights` in the brief, the 5 ranked Customer Intelligence recommendations, Ad Spy's 3 recommendations, self-review's ranked items, and proactive suggestions (usage-gap detection). None carry estimated impact, cost, effort, time-to-result, dependencies, risk, responsible agent, success metric, or stop condition. No unified opportunities table. ("opportunit" grep hits are prose in prompts, plus Capital & Funding — a different subsystem.)

## 11. Strategy Engine — **Does not exist**

Goals exist (`060_target_goals.sql` + snapshots + alerts) and auto-optimization uses goal targets, but there is no annual/quarterly/monthly planning structure, no budget-allocation strategy, no channel-mix model, no offer strategy, no risk register, and no lifecycle distinguishing recommendation → approved → active test → scaled winner → retired. Recommendations are prose that expires with the next report.

## 12. Experiment system — **Does not exist**

Grep for experiment/hypothesis finds only the flag-off Conversational Core prototype (unrelated). No hypothesis/control/threshold/decision records anywhere. The Learning Engine (§23) learns *owner preferences*, not *market results* — Sage generates fresh ideas each cycle rather than learning from controlled tests.

## 13. Performance intelligence

Real: spend, impressions, clicks, CTR, leads, conversions, ROAS from Facebook Insights (`analyticsController.js`, weekly `analytics` table); lead temperature/conversion status; appointment records. **Estimated, not real:** ROI dashboard "value generated / hours saved / money saved" uses industry-average assumptions in `config/roiModel.js` (lead value $75–$350, $60/hr labor) — this is honest modeling but is a **vanity-adjacent** number if read as revenue. **Missing entirely:** revenue, gross profit, CAC, LTV, close/quote/show rates, retention, referral rate, cost-per-acquisition tied to actual sales. The platform never learns what a closed deal was worth, so nothing downstream can connect marketing to profit.

## 14. Attribution

Campaign-level only: `campaigns.facebook_campaign_id` links spend/lead metrics; `leads` rows carry a source (chatbot/SMS/email/manual paths set it at insert). **No** multi-touch attribution, no UTM capture, no touchpoint history, no "which follow-up converted it," no attribution confidence. Autonomous Conversations know their channel but conversions aren't attributed back to originating campaigns. **Largely missing.**

## 15. Forecasting — **Does not exist**

Zero matches for forecasting logic anywhere in `EchoAI/` server code. No lead-volume, spend, pipeline, seasonality, churn, or AI-cost forecasts.

## 16. Brand & reputation intelligence

Reputation subsystem (Pro) fetches reviews + drafts honest replies; Company Truth captures review themes; feedback subsystem does sentiment. **No** competitor review movement, review-velocity tracking, tone/visual/message consistency auditing, or claim-accuracy checking. Findings reach Nova/Forge only via the Forge brief (Pattern Intel) and Vision guidance — not from reputation data.

## 17. Geographic intelligence

Exists narrowly: brand `geo_targeting` with hard exclusion zones enforced on every channel; Sage auto-adds legal exclusions; FB targeting fails closed to state level. **No** per-region performance analysis, competitor density, travel cost, local demand, or expansion analysis.

## 18. Offer intelligence — **Does not exist** as a system

Offers appear only as prose in research/pricing sections and Ad Spy observations. No offers table, no performance tracking, no margin modeling.

## 19. Creative intelligence (Sage / Vision / Forge)

Clear, non-duplicative division found in code: **Vision = analyst/source** (`utils/visionEngine.js` studies competitor ad text, own image history, owner reference photos → `vision_knowledge`: structural standards, composition, lighting, palettes, avoid-lists; consulted via `getGuidanceForImageRequest` by autopilot, Image Studio, Ad Studio). **Pattern Intelligence = market-level craft trends → Forge brief.** **Forge = executor.** What's missing: creative *performance* feedback (which of OUR creatives performed, fatigue detection, budget-shift recommendations) — the loop from published creative → results → Vision/Forge learning **does not exist**.

## 20. Sales & operational intelligence

From Pulse/Voice, Sage-adjacent systems see: lead temperature, response staleness (Echo Assistant auto-tasks from stale hot leads), call records, conversation outcomes. Sentinel (health monitor) detects: failed posts/SMS/email, broken connections/expired tokens (re-verify sweep), API quota issues — and **self-review** studies exactly these weekly. **Not detected:** unassigned leads, quote delay, salesperson performance, duplicate campaigns, budget overspend vs plan, capacity limits.

## 21. Interdepartmental communication

| Link | Mechanism | Structured? |
|---|---|---|
| Sage → Owner/Echo | Sage feed, morning briefing lines, urgent voice+SMS pages | JSON feed + spoken prose |
| Sage → Forge | `forge_brief` JSONB in `sage_pattern_insights` | **Structured** |
| Sage → Atlas | geo exclusions written into brand settings; goal targets drive auto-optimization | Structured (settings) |
| Vision → Forge/Studios | `vision_knowledge` via guidance calls | Structured |
| Scout(Ad Spy) → Owner | alerts + weekly prose report | Mostly prose |
| Sage → Nova/Pulse/Voice | **None found** | — |
| Departments → Sage (results feedback) | **None found** beyond weekly analytics aggregates | — |

Nothing is written back into a shared brain from execution results. Communication is hub-and-spoke through the owner, not agent-to-agent.

## 22. Shared intelligence schema — **Does not exist**

Each system has its own table shape. Common fields (brand_id, date, url, summary) exist, but there is no unified item schema with category/confidence/relevance/impact/assigned-agent/status/result/learning. Reports (ad-intel weekly, customer-intelligence prose, self-review) are largely isolated prose other agents cannot consume.

## 23. Decision review & learning loop

What exists: **Learning Engine** (`utils/learningEngine.js`; `echo_learning_signals` → Monday distill → `echo_learnings` injected into drafting prompts + `echo_open_questions` surfaced in briefings) — this genuinely learns, but only *owner content preferences* from approve/decline/revise. Sage feed supports dismissal (soft, dedup-protected). **What does not exist:** any record of whether a Sage recommendation was acted on, whether it worked, or why — Sage's own recommendations vanish into the next cycle. Sage does not improve from outcomes.

## 24. Sage's authority

Autonomous: research/gathering; geo-exclusion application (legal findings); alert paging (urgent/aggressive-ad, deduped). Adjacent-autonomous: Atlas auto-optimization moves ad-set budgets within goal guardrails. Everything else is recommendation-only or approval-gated: Company Truth (owner approve), competitor confirmation, autopilot content (approve/decline/revise), self-review (admin triage only). This is a **conservative, well-guarded authority model** — appropriate.

## 25. Cost & efficiency

- All Sage calls go through `createMessage` (Anthropic; web_search-enabled prompts) with usage logged to the AI ledger (`ai_usage_log`, migrations 097/104); costs tracked **per feature and user** with per-tier internal budgets (Starter $40 / Pro $100 / Enterprise $200) surfaced to customers as "Workforce Capacity %" (`usageCapacityController.js`). Quota monitor + self-review watch spend.
- Heaviest recurring spend: 6-hour deep cycle per brand (up to 6 searches each) and, if enabled, the 30-min urgent scan (up to 3 searches × 48/day) — the urgent scan being off by default is the right cost posture.
- Duplication risk: Industry Brief, Ad Spy weekly report, Customer Intelligence weekly, and Self-Review all generate partially overlapping "here's what's happening + recommendations" prose on Mondays. Cache/merge opportunity.
- **No cost-per-useful-insight measurement exists** (would require the missing decision-review loop).

## 26. Failure risks (ranked)

1. **No feedback loop** — recommendations are never scored, so quality can't improve and duplicate/conflicting advice across the four Monday reports is unchecked.
2. **Company Truth not consumed** — the flagship honesty artifact isn't injected into other agents' prompts yet; agents can drift off-truth.
3. **Vanity framing** — ROI dashboard estimates read like revenue; no real revenue/close data exists to correct it.
4. **No confidence scoring anywhere** — every finding is presented with equal weight.
5. **Attribution gaps** — cannot connect a campaign to a closed customer.
6. Uncited prose in weekly ad-intel reports.
7. Alert fatigue risk is *low* today (good dedup/CAS discipline), but grows if urgent scan is enabled broadly.
8. Fabrication risk is **low** — citation enforcement, `missingInformation`, prevalence-not-causation, and no-FB-token → no-op patterns are consistently applied.

## 27. Readiness scores (1–10, code-grounded)

| Dimension | Score | Why |
|---|---|---|
| Company understanding | **7** | Structured, versioned, approval-gated, honest gaps — but key inputs (CRM history, goals, offers, GBP) missing and output barely consumed |
| Market intelligence | **6** | Real web-grounded, cited, 6-hourly — but no structured signals (seasonality, economics) and no relevance feedback |
| Competitor intelligence | **7** | Confirmed-competitor model, real Ad Library + site diffs + alerts; no pricing/review/hiring depth, no new-entrant detection |
| Customer intelligence | **5** | Broad internal synthesis weekly (Enterprise) — but no objections/lost-deal/LTV data exists to analyze |
| Pattern recognition | **5** | Real, honest, prevalence-based — external ads only; no cross-source pattern engine |
| Strategic reasoning | **3** | Prose recommendations only; no strategy lifecycle, priorities, or budget allocation model |
| Experiment design | **1** | Does not exist |
| Performance measurement | **4** | Real FB funnel top; no revenue/close/CAC/LTV; ROI is estimates |
| Attribution | **2** | Campaign-level only |
| Forecasting | **1** | Does not exist |
| Interdepartmental communication | **4** | Two structured links (Forge brief, Vision guidance, geo-exclusions); no results write-back |
| Learning | **3** | Owner-preference learning is real; outcome learning absent |
| Reliability | **8** | Atomic claim ledgers, dedup, fail-closed patterns, 502 mapping, pause_turn now fixed |
| Cost efficiency | **6** | Per-feature ledger + budgets + capacity display; Monday-report overlap and no value-per-insight measure |
| Customer trust | **7** | Approval gates, honesty invariants, no fabrication; ROI estimate framing is the weak spot |
| Public-launch readiness (Sage as shipped) | **7** | What the UI promises, the code delivers. |
| Public-launch readiness (Sage as "strategy brain") | **3** | The reasoning/measurement layer is mostly unbuilt. |

## 28. Gap analysis vs the ideal operating chain

```
Company Truth        ✅ built, versioned, approved   ❌ not consumed by departments
Source Intelligence  ✅ cited gathering              ❌ no confidence/verification schema
Competitor/Market/Customer/Channel  ◐ 3 of 4 solid  ❌ channel matrix missing
Pattern Intelligence ◐ external ads only            ❌ no cross-source patterns
Opportunity Engine   ❌ does not exist
Strategy Engine      ❌ does not exist
Owner Approval       ✅ consistently enforced
Execution by departments ✅ exists (Nova/Atlas/Forge/Pulse)  ❌ no structured task handoff from Sage
Performance Measurement ◐ FB funnel only            ❌ no revenue/close loop
Success/failure review ❌ does not exist for Sage recommendations
Company Brain update ❌ no results write-back
```

Highest-leverage missing links, in dependency order:
1. **Wire `getApprovedCompanyTruth` into every department's prompt context** — small effort, uses what's already built, immediately raises on-brand quality. (Prerequisite for everything else.)
2. **Shared intelligence item schema + unified findings store** — medium effort; lets opportunities, patterns, and reports reference the same evidence.
3. **Outcome capture** (deal value / closed-won on leads + recommendation status tracking) — medium; unlocks attribution, real ROI, and learning.
4. **Opportunity Engine** (ranked, evidence-linked, owner-approved, assigned to a department, with success metric + stop condition) — the piece that turns Sage from reporter into director. Depends on 1–3.
5. Experiments + forecasting — after 3–4; meaningless without outcome data.

## 29. Recommended rebuild plan (for your approval, Sir — no code written)

**Before public launch (critical):**
- Wire Company Truth into Nova/Atlas/Forge/Pulse/Echo prompts (Layer 2 as designed).
- Reframe ROI dashboard copy to say "estimated" prominently wherever the model numbers appear (trust protection).
- Consolidate the four overlapping Monday reports into one Sage weekly digest (cost + coherence).

**High-value after launch:** shared intelligence schema → outcome capture on leads (deal value) → recommendation status tracking → Opportunity Engine → experiments/forecasting.

**Preserve as-is:** Company Truth lifecycle, citation enforcement, confirmed-competitor model, Pattern Intelligence honesty, Vision/Forge division, self-review, claim/dedup/fail-closed engineering.

**Merge:** Customer Intelligence + weekly analytics + ad-intel weekly → single Sage performance review. Site Monitor + Ad Spy → one Competitor Watch pipeline (they already share the competitor list).

**Rename/clarify:** "Marketing Insights" tab is a view of the brief, not a separate engine — either merge into the brief tab or make it the front of the future Opportunity Engine. Nothing found that is misleading enough to remove.

**Decisions requiring your approval:** enabling the urgent scan (cost), consolidating Monday reports (changes what customers see), adding deal-value capture (asks customers for revenue data), and the Opportunity Engine build order.
