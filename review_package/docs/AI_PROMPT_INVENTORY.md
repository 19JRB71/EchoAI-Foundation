# AI Prompt Inventory

**Scope:** Every prompt template, system prompt, and prompt builder used by Zorecho/EchoAI, verified against `EchoAI/prompts/` and inline prompt call sites on 2026-07-24.

**Method:** Enumerated all 44 files in `EchoAI/prompts/` and grepped controllers/utils for `require("../prompts/…")`, `system:`, and `anthropic.messages` / `createMessage` / `streamMessage` / Hermes `createCompletion` call sites. Prompts are **not rewritten** here.

**Model note:** unless stated, prompts are sent to **Anthropic Claude** (`claude-sonnet-4-6`, `config/anthropic.js`). Hermes-brain prompts (routing/triage) go to **Nous Hermes 4** (`config/hermes.js`). Some prompts drive **OpenAI DALL-E** (image generation) via the builder output.

**Output handling / validation legend:** Many prompt modules ship their own `extractJson*` / `validate*` helpers; where present, output is parsed/validated and malformed AI output is treated as an error (commonly surfaced as HTTP 502 by the calling controller), **not** silently accepted.

---

## 1. Files in `EchoAI/prompts/`

| # | File | Key exports | Agent / system that uses it | Trigger | Output & validation | Can trigger real external action? |
|---|---|---|---|---|---|---|
| 1 | `adCreativePrompt.js` | `buildAdCreativePrompt`, `generateCreativeVariations` | Atlas — `campaignController.js`, `optimizationController.js`, `autonomousGrowthController.js` | Ad creation / variation generation | Ad copy + image prompt | Feeds ad launch (Facebook) → UNVERIFIED live |
| 2 | `adCreativeStudioPrompt.js` | `AD_CREATIVE_DIRECTOR_SYSTEM_PROMPT`, `buildAdCreativeStudioPrompt` | Forge/Atlas — `adCreativeStudioController.js` | Ad Creative Studio generate | Structured creative package | Indirect (creatives used in ads) |
| 3 | `appointmentBookingPrompt.js` | `buildAppointmentSchedulerPrompt`, `buildPhoneBookingExtractionPrompt` | Voice — `phoneController.js`, `websiteChatbotController.js` | During call/chat booking | Booking slots / extracted intent | Writes `appointments`; no external send by itself |
| 4 | `autonomousReplyPrompt.js` | `buildAutonomousReplyPrompt`, `extractText` | Autonomous Conversation engine — `autonomousConversationController.js` | Lead replies to outbound msg | Reply text (Claude) | Yes — reply sent via SMS/email → UNVERIFIED live |
| 5 | `autopilotPrompt.js` | `buildWeeklyBatchPrompt`, `generateWeeklyBatch`, `reviseAdDraft`, `draftInstantPost` | Nova — `autopilotController.js` | Autopilot weekly batch / instant post | Week of posts/graphics drafts | Scheduling → publish UNVERIFIED live |
| 6 | `brandDiscoveryPrompt.js` | `BRAND_DISCOVERY_SYSTEM_PROMPT`, `BRAND_PROFILE_SYNTHESIS_PROMPT` | Onboarding/Scout — `brandDiscoveryController.js` | Onboarding brand discovery | Brand profile JSON (auto-save on confirm, 2026-07-24) | No (internal profile) |
| 7 | `campaignOptimizationPrompt.js` | `COMPETITOR_ANALYSIS_SYSTEM_PROMPT`, `CAMPAIGN_OPTIMIZATION_SYSTEM_PROMPT`, `buildCompetitorAnalysisPrompt`, `buildCampaignOptimizationPrompt` | Atlas — `optimizationController.js` | Campaign optimization run | Optimization recommendations | Advisory; may drive ad edits |
| 8 | `companyTruthPrompt.js` | `SYSTEM`, `buildPrompt`, `generateCompanyReport` | Sage — `companyTruthController.js` | Company Truth report generation | Company Truth report (owner-approved) | No; approved digest injected platform-wide via `withTruthSystem()` |
| 9 | `competitorAdReportPrompt.js` | `buildReportSystem`, `validateReport`, `buildCounterSystem`, `generateAdReport`, `draftCounterCampaign` | Scout — `competitorAdSpyController.js` | Competitor ad spy report / counter-campaign | Validated report JSON | Reads real FB ad data; counter feeds ads |
| 10 | `competitorSitePrompt.js` | `ANALYZE_SYSTEM`, `CHANGE_SYSTEM`, `analyzeWebsite`, `detectChanges`, `extractJson` | Scout — `competitorSiteController.js` | Competitor site add / change sweep | Analysis + change detection JSON | Fetches external websites (real) |
| 11 | `contentCalendarPrompt.js` | `buildCalendarPrompt`, `buildSinglePostPrompt`, `composePostContent`, `DEFAULT_POSTING_TIMES`, `extractJsonArray/Object` | Nova — `contentCalendarController.js`, `voiceContentController.js`, `autopilotController.js` | Calendar / post generation | Calendar + post JSON | Scheduling → publish UNVERIFIED live |
| 12 | `crossBusinessPrompt.js` | `buildCrossBusinessPrompt`, `generateCrossBusinessIntelligence` | Echo/Portfolio — `portfolioController.js`, `utils/scheduler.js` | Cross-business intelligence (scheduled) | Portfolio intelligence report | No |
| 13 | `customerIntelligencePrompt.js` | `buildIntelligencePrompt`, `generateIntelligence` | Scout — `customerIntelligenceController.js` | Customer intelligence generation | Intelligence brief | Uses web search (real) |
| 14 | `echoPersona.js` | `buildBriefingSystem` | Echo — `utils/echoBriefing.js` (+ persona for `echoCompanionController`) | Morning briefing / Echo persona | Briefing text | No |
| 15 | `emailCampaignPrompt.js` | `buildEmailCampaignPrompt`, `extractJsonArray` | Pulse — `emailCampaignController.js` | Email campaign generation | Email content JSON | Send via nodemailer → UNVERIFIED live |
| 16 | `emailMarketingPrompt.js` | `extractText`, `extractJson` (+ builders) | Pulse — `emailMarketingController.js` | Email marketing generation | Email content JSON | Send → UNVERIFIED live |
| 17 | `feedbackAnalysisPrompt.js` | `SURVEY_DESIGNER_SYSTEM_PROMPT`, `FEEDBACK_ANALYST_SYSTEM_PROMPT`, `buildSurveyGenerationPrompt`, `buildFeedbackAnalysisPrompt`, `validateFeedbackReport` | Feedback — `feedbackController.js` | Survey design / feedback analysis | Validated report | No |
| 18 | `followUpSequencePrompt.js` | `buildFollowUpPrompt`, `extractJsonArray` | Pulse — `followUpController.js` | Follow-up sequence generation | Sequence JSON | Steps sent via SMS/email → UNVERIFIED live |
| 19 | `fundingIntelligencePrompt.js` | `buildFundingPrompt`, `generateFundingOpportunities` | Scout — `capitalFundingController.js` | Funding/grant opportunity scan | Opportunity list | Uses web search (real) |
| 20 | `goalSetupPrompt.js` | `buildGoalSetupPrompt` | Goals — `goalController.js` | Goal setup wizard | Goal suggestions JSON | No |
| 21 | `grantWriterPrompt.js` | `buildGrantPrompt`, `validateGrantDraft`, `draftGrantApplication` | Scout — `capitalFundingController.js` | Grant application drafting | Validated grant draft | No (draft only) |
| 22 | `guidedSetupPrompt.js` | `buildSetupHelpSystemPrompt`, `analyzeSetupHelpScreenshot` | Onboarding — `guidedSetupController.js` | Guided Setup help / screenshot analysis | Help guidance (Claude vision) | No |
| 23 | `healthMonitorPrompt.js` | `buildHealthAnalysisPrompt`, `buildSupportSystemPrompt` | Sentinel — `healthMonitorController.js` | Nightly health sweep / support widget | Health analysis + support answers | Advisory; auto-fix scope UNVERIFIED |
| 24 | `imagePromptBuilder.js` | `buildImagePrompt`, `VARIANT_STYLES` | Forge — `imageController.js`, `autopilotController.js`, `voiceContentController.js` | Image generation | DALL-E prompt string | Yes — OpenAI DALL-E 3 (real API) |
| 25 | `imagePromptEngineerPrompt.js` | `buildSystemPrompt`, `buildBrandStyleSummary`, `normalizePrompt`, `extractText/JsonArray`, `NUM_PROMPTS` | Forge — `imageController.js` | Prompt engineering for images | Engineered prompts JSON | Feeds DALL-E (real) |
| 26 | `leadQualificationPrompt.js` | `LEAD_SCORING_PROMPT`, `buildLeadQualificationPrompt`, `buildBrandContext` | Voice/Pulse — `chatbotController.js`, `phoneController.js` | Lead qualification / scoring | Qualification + score JSON | Writes leads; no external send |
| 27 | `opportunityIntelligencePrompt.js` | `buildOpportunityPrompt`, `generateOpportunityIntelligence` | Scout — `capitalFundingController.js` | Opportunity intelligence | Opportunity report | Uses web search (real) |
| 28 | `opportunitySynthesisPrompt.js` | `buildOpportunitySynthesisPrompt` | Sage — `utils/opportunitySynthesis.js` | Sage opportunity synthesis (feature `sage_opportunity_synthesis`) | Synthesized opportunities JSON | No |
| 29 | `patternIntelligencePrompt.js` | `ANALYZE_SYSTEM`, `REPORT_SYSTEM`, `extractJson` | Sage (Pattern Intelligence Engine) — `utils/patternIntelligence.js` | Pattern intelligence analysis/report | Analysis + report JSON | No |
| 30 | `phoneAgentPrompt.js` | `CALL_DISPOSITION_PROMPT`, `buildPhoneAgentPrompt`, `buildBrandContext` | Voice — `phoneController.js` | Live phone call handling | Conversation turns + disposition | Yes — Twilio calls → UNVERIFIED live |
| 31 | `reputationPrompt.js` | `buildReviewResponsePrompt`, `generateReviewResponse` | Reputation — `reputationController.js` | Review response drafting | Response text | Draft only unless posted externally |
| 32 | `roiAnalystPrompt.js` | `buildRoiAnalysisPrompt`, `generateRoiAnalysis` | Atlas/ROI — `roiDashboardController.js` | ROI dashboard analysis | Analysis text | No |
| 33 | `roiReportPrompt.js` | `buildRoiReportPrompt`, `generateRoiReport` | ROI — `roiController.js` | ROI report generation | Report text | No |
| 34 | `sagePrompt.js` | `DEEP_SYSTEM`, `URGENT_SYSTEM`, `SUGGEST_SYSTEM`, `REFRESH_SYSTEM`, `extractJson` (largest prompt file, ~24 KB) | Sage — `sageController.js` | Deep study / urgent signals / suggestions / refresh | Multiple structured JSON outputs | Uses web search (real); writes intel |
| 35 | `salesAgentPrompt.js` | `buildSalesAgentPrompt`, `buildCoPilotPrompt`, `INTEREST_SCORING_PROMPT`, `buildSalesSummaryPrompt`, `buildObjectionGuidance`, `VALID_SALES_OUTCOMES` | Sales Agent (Zorecho's own line) — `salesAgentController.js` | Inbound demo sales calls | Conversation + scoring + summary | Yes — platform Twilio → UNVERIFIED live |
| 36 | `salesScriptPrompt.js` | `buildSalesScriptPrompt`, `extractJsonObject` | Forge — `salesScriptController.js` | Sales script generation | Script JSON | No |
| 37 | `seoContentPrompt.js` | `buildSeoContentPrompt`, `generateKeywordSuggestions`, `extractJsonObject/Array` | Scout — `seoController.js`, `setupAgentController.js` | SEO content / keyword suggestions | SEO content JSON | No |
| 38 | `setupAgentPrompt.js` | `SETUP_AGENT_SYSTEM_PROMPT` | Setup Agent — `setupAgentController.js` | Onboarding conversation | Setup guidance; malformed → 502 | Delegates to feature controllers |
| 39 | `smsMarketingPrompt.js` | `buildVariationsPrompt`, `buildAutoReplyPrompt`, `extractText/JsonArray/Object` | Pulse — `smsMarketingController.js` | SMS campaign / auto-reply generation | SMS content JSON | Send via Twilio → UNVERIFIED live |
| 40 | `socialContentPrompt.js` | `buildSocialContentPrompt`, `generateSocialPosts`, `extractJsonArray` | Nova — `socialController.js`, `utils/realEstateAutomation.js` | Social post generation | Post content JSON | Publish → UNVERIFIED live |
| 41 | `strategyDraftPrompt.js` | `buildStrategyDraftPrompt` | Sage — `utils/sageStrategy.js` (feature `sage_strategy_draft`) | Strategy draft synthesis | Strategy JSON | No |
| 42 | `videoContentPrompt.js` | video script builders | Forge — `videoContentController.js` | Video script/package generation | Script JSON | No |
| 43 | `voiceContentPrompt.js` | `generateVoiceDrafts`, `reviseVoiceDraft`, `extractJsonObject` | Nova/Echo — `voiceContentController.js`, `autopilotController.js`, `opportunitySynthesis.js`, `sageStrategy.js` | Voice-driven content drafting | Draft JSON | Scheduling → publish UNVERIFIED live |
| 44 | `websiteChatbotPrompt.js` | website chatbot builders | Voice — `websiteChatbotController.js`, `chatbotController.js` | Embeddable chatbot conversation | Reply + slot extraction | Writes leads/appointments; no external send |

`prompts/README.md` — documentation stub (not a prompt).

---

## 2. Inline prompts (not in `prompts/`)

These system prompts are defined directly in controller/util files (found via `system:` grep). They are the "hidden instructions" for their features.

| File | Purpose | Model |
|---|---|---|
| `controllers/echoCompanionController.js` (~line 864) | **Echo's main conversational system prompt** — includes the mandatory `[[FEATURE_REQUEST: …]]` and `[[REMEMBER: …]]` markers the platform parses; streamed replies | Claude (`streamMessage`) |
| `controllers/echoAssistantController.js` | Voice-command → structured reminder/task intent parsing | Claude |
| `utils/echoOrchestrator.js` | Hermes routing/intent decision (TEAM + RULES) | Hermes 4 |
| `utils/autonomousConversationBrain.js` | Hermes lead-reply triage (state/temperature/directive) | Hermes 4 |
| `utils/competitorAdBrain.js` | Hermes competitor-ad reasoning | Hermes 4 |
| `utils/conversationalCore.js` | Experimental Core: Hermes intent + Claude reply (flag OFF) | Hermes + Claude |
| `utils/leadOutcome.js` | Hermes lead-outcome reasoning | Hermes 4 |
| `utils/emailMonitor.js` | Email categorize/summarize/draft (inbox sweep) | Claude |
| `utils/echoContext.js`, `utils/aiContext.js` | Context assembly for prompts (Company Truth, Phase 4 injection via `withTruthSystem`) | n/a (context) |
| `utils/featureSuggestions.js` | Feature-request classification/summarization | Claude |
| `controllers/capitalFundingController.js`, `optimizationController.js`, `goalController.js`, `adCreativeStudioController.js` | Additional inline system framing alongside their `prompts/*` builders | Claude |

---

## 3. Cross-cutting observations (for the reviewer)

- **Company Truth injection:** `config/anthropic.js withTruthSystem()` silently appends the owner-approved Company Truth digest (+ Sage Phase 4 offers/constraints/memory) to EVERY brand-scoped Claude system prompt when `SAGE_V2_CONTEXT` (and related flags) are ON. **These flags default OFF**, so by default prompts do NOT carry the Truth digest — verify the intended prod flag state.
- **Audience gating:** `withTruthSystem()` distinguishes `customer` vs `internal` audience so customer-facing prompts get only an allowlist of public offer fields — a deliberate data-leak guard.
- **Marker-based side effects:** Echo's prompt relies on the model emitting exact `[[FEATURE_REQUEST]]` / `[[REMEMBER]]` markers; if the model omits them the intended side effect is silently lost (documented risk in the prompt text itself).
- **Validation discipline is uneven but present:** many report/JSON prompts ship `validate*`/`extractJson*` helpers and map failures to 502; simpler text prompts do not validate output.
- **Potential overlap/duplication to investigate:** `adCreativePrompt.js` vs `adCreativeStudioPrompt.js` (two ad-creative generators); `emailCampaignPrompt.js` vs `emailMarketingPrompt.js`; `roiAnalystPrompt.js` vs `roiReportPrompt.js`; multiple `extractJson*` helpers re-implemented across prompt files (`voiceContentPrompt.js`'s `extractJsonObject` is imported by others as the shared one).
- Prompts were **not modified** during this review.
