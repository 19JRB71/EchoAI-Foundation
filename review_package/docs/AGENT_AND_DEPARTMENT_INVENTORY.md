# Agent and Department Inventory

**Scope:** Every AI department head, agent, worker, assistant, and AI-related component in the Zorecho/EchoAI platform, verified against the current code in `EchoAI/` on 2026-07-24.

**Truthfulness note:** Labels used below — **VERIFIED** (code path proven to run), **PARTIALLY IMPLEMENTED**, **UI ONLY**, **SIMULATED**, **UNVERIFIED** (real code exists but end-to-end external result not confirmed), **UNKNOWN**. A database record, screen, or success message is NOT treated as proof that an external action occurred. Live external actions (Facebook publish, Twilio calls/SMS, Stripe charges, email sends) have not been verified end-to-end in production and are therefore labelled **UNVERIFIED (real code, untested externally)** unless a doc states otherwise.

---

## 1. AI model layer (shared infrastructure)

The platform uses a deliberate **two-brain split** (documented in `config/hermes.js` and `config/anthropic.js`):

| Provider | Model (default / env) | Role | Config file |
|---|---|---|---|
| Anthropic Claude | `claude-sonnet-4-6` (`ANTHROPIC_MODEL`) | The **writer/creator**: ad copy, emails, briefings, content, analysis, structured JSON generation | `config/anthropic.js` |
| Nous Research Hermes 4 | `nousresearch/hermes-4-70b` (`NOUS_HERMES_MODEL`), OpenAI-compatible `/chat/completions` | The **decision/orchestration brain**: intent detection, routing, conversation-state triage | `config/hermes.js` |
| OpenAI | Whisper (STT), TTS, DALL-E 3 (images) | Voice transcription, some TTS, image generation | `config/openai.js` |
| ElevenLabs | `eleven_flash_v2_5` (`ELEVENLABS_MODEL_ID`) | Primary TTS voice for Echo | `config/elevenlabs.js` |

Every paid call passes through a shared admission gate (`utils/aiGate.js`) and usage ledger (`utils/aiUsage.js`) with retry-on-transient logic. **When a key is missing, the client is replaced with a stub that fails loudly on call — the server never fabricates AI output** (see `utils/optionalClient.js`).

**Hermes is advisory / non-breaking by design.** If `NOUS_PORTAL_API_KEY` is unset, orchestration/decision helpers return `null` and callers fall back to prior behavior. Consumers of Hermes: `utils/echoOrchestrator.js`, `utils/autonomousConversationBrain.js`, `utils/competitorAdBrain.js`, `utils/conversationalCore.js`, `utils/aiContext.js`, `utils/leadOutcome.js`, `utils/aiGate.js`.

---

## 2. The ten department agents

Roster source of truth: backend `controllers/agentsController.js` (`AGENTS`) mirrored client-side by `client/src/lib/departments.js` (`AGENTS_META` + `DEPARTMENTS`).

**Important architectural fact:** The "agents" are a **presentation/aggregation layer**, not autonomous long-running processes. `agentsController.computeAgents()` derives each agent's live `status` and `currentTask` **read-only** from the tables the underlying feature subsystems already write (leads, campaigns, social_posts, calls, images, health_checks, etc.). An agent's "Active/Working/Attention" state is a computed reflection of real data — the agent card itself does not "do work"; the underlying feature controllers do. This is honest but means the "team" metaphor is a UI framing over conventional feature controllers.

Team members who are invited (non-owner) never see **Sentinel** (`canSeeSentinel()` gate).

### Echo — Marketing Director (`id: echo`)
- **Intended role:** Runs the whole operation; knows every campaign/customer/result; morning briefings; approvals; memory; reminders; email assistant.
- **Actual role:** Conversational front-end + status rollup + orchestrator. Real conversational brain in `controllers/echoCompanionController.js` (Claude, streaming via `streamMessage`, model `MODEL`). Routing decisions via Hermes (`utils/echoOrchestrator.js`). Briefings in `utils/echoBriefing.js` (`prompts/echoPersona.js`).
- **Prompt location:** `prompts/echoPersona.js` (persona + briefing system) plus large inline system prompt in `controllers/echoCompanionController.js` (~line 864).
- **Model:** Claude for replies; Hermes for routing.
- **Real actions:** Emits `[[FEATURE_REQUEST: …]]` and `[[REMEMBER: …]]` markers the platform parses to log feature requests / store memories (VERIFIED code path). Can navigate the UI and describe what other departments do. **Text + limited platform-internal actions**; does not itself publish externally.
- **Approval gates:** Autonomous growth proposals are surfaced as `growth_actions` with status `proposed` (owner approval required — see Autonomous Growth below).
- **Status:** VERIFIED (conversational + status layer). Autonomy limited to proposals.

### Scout — Research Specialist (`id: scout`)
- **Intended role:** Watches competitors, finds trends/keywords/audiences, weekly opportunity reports.
- **Actual role:** Customer/competitor intelligence generation. Controllers: `customerIntelligenceController.js` (`prompts/customerIntelligencePrompt.js`), `competitorAdSpyController.js` (`prompts/competitorAdReportPrompt.js`, + `utils/competitorAdBrain.js` Hermes), `competitorSiteController.js` (`prompts/competitorSitePrompt.js`), `capitalFundingController.js` (funding/grants), `seoController.js`.
- **Model:** Claude (with web-search server tool per `config/anthropic.js` pause-turn handling).
- **Real actions:** Fetches/analyzes external competitor sites and ads; writes intelligence rows. External web access is real; **UNVERIFIED end-to-end reliability**. Text/report output otherwise.
- **Status:** VERIFIED code; PARTIALLY covered by tests.

### Atlas — Advertising Manager (`id: atlas`)
- **Intended role:** Builds/manages Facebook & Google ads, optimizes budgets, tracks ROI.
- **Actual role:** Ad creative + campaign generation and optimization. Controllers: `campaignController.js`, `adCreativeStudioController.js`, `optimizationController.js` (`prompts/campaignOptimizationPrompt.js`, `adCreativePrompt.js`), ROI via `roiController.js`/`roiDashboardController.js`.
- **Real actions:** Facebook ad publishing/launch — see `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`. Actual live ad launch is **UNVERIFIED (real code, untested externally)**; Facebook staging connect not yet tested. Requires Facebook connected (`api_integrations`).
- **Status:** PARTIALLY IMPLEMENTED / UNVERIFIED for live launch.

### Nova — Social Media Manager (`id: nova`)
- **Intended role:** Posts daily, builds content calendars, cross-platform visibility.
- **Actual role:** Content calendar + social post generation + scheduling. Controllers: `contentCalendarController.js` (`prompts/contentCalendarPrompt.js`), `socialController.js` (`prompts/socialContentPrompt.js`), `autopilotController.js` (`prompts/autopilotPrompt.js`).
- **Real actions:** Generates and schedules posts (`social_posts`). Actual publishing to platforms via Facebook Graph — **UNVERIFIED end-to-end**. Failed posts surface in Mission Control feed (`status = 'failed'`).
- **Status:** Generation VERIFIED; live publish UNVERIFIED.

### Pulse — CRM Manager (`id: pulse`)
- **Intended role:** Never forgets a lead — follows up, books appointments, scores prospects.
- **Actual role:** Leads/CRM, follow-up sequences, appointments, email & SMS marketing, voter/property CRM. Controllers: `leadController.js`, `crmController.js`, `followUpController.js` (`prompts/followUpSequencePrompt.js`), `appointmentController.js`, `emailMarketingController.js`, `smsMarketingController.js`, `supporterController.js`, `propertyController.js`.
- **Real actions:** Email sends (nodemailer), SMS (Twilio) — see external-action doc; **UNVERIFIED live**.
- **Status:** VERIFIED generation/CRM logic; external delivery UNVERIFIED.

### Voice — AI Receptionist (`id: voice`)
- **Intended role:** Answers phone, qualifies leads, books appointments 24/7.
- **Actual role:** Per-brand phone agent + website chatbot. Controllers: `phoneController.js` (`prompts/phoneAgentPrompt.js`, `appointmentBookingPrompt.js`, `leadQualificationPrompt.js`), `websiteChatbotController.js`/`chatbotController.js`.
- **Model:** Claude for conversation; Twilio for telephony; OpenAI/ElevenLabs for voice.
- **Real actions:** Twilio inbound/outbound calls & TwiML `<Gather>` loop. Requires per-brand `twilio_config`. **UNVERIFIED live** (default per global rules; would spend money to test).
- **Status:** PARTIALLY IMPLEMENTED / UNVERIFIED live.

### Forge — Creative Director (`id: forge`)
- **Intended role:** Ad images, video scripts, copy, social visuals.
- **Actual role:** Image studio, video content, ad creative, sales scripts. Controllers: `imageController.js` (`prompts/imagePromptBuilder.js`, `imagePromptEngineerPrompt.js`), `videoContentController.js`, `adCreativeStudioController.js`, `salesScriptController.js`. Consults **Vision** in-process (`getGuidanceForImageRequest`).
- **Real actions:** DALL-E 3 image generation via OpenAI (real API call). Images stored in `images`. Generation VERIFIED code; live external cost applies.
- **Status:** VERIFIED (image/text generation).

### Sentinel — Oversight Agent (`id: sentinel`) — owner/admin only
- **Intended role:** Watches all agents nightly, catches and auto-fixes problems.
- **Actual role:** Health monitoring + auto-fix + platform status. Controllers: `healthMonitorController.js` (`prompts/healthMonitorPrompt.js`), `diagnosticsController.js`. Client: `sections/SentinelHealth.jsx`.
- **Real actions:** Nightly health sweeps write `health_checks` (see `AUTOMATION_AND_BACKGROUND_JOBS.md` for scheduler). "Auto-fix" scope should be verified against actual remediation code — **PARTIALLY IMPLEMENTED / UNVERIFIED** for the breadth implied by the blurb.
- **Status:** PARTIALLY IMPLEMENTED.

### Sage — Industry Intelligence Agent (`id: sage`)
- **Intended role:** Studies the industry around the clock; company truth; competitor watch; marketing insights.
- **Actual role:** Multi-phase intelligence engine. Controllers: `sageController.js` (`prompts/sagePrompt.js`), `companyTruthController.js` (`prompts/companyTruthPrompt.js`), `sageBriefingController.js`, `sagePhase4Controller.js`, `sagePhase5Controller.js`, `sagePhase6Controller.js`. Utils: `sageStrategy.js` (`prompts/strategyDraftPrompt.js`), `patternIntelligence.js` (`prompts/patternIntelligencePrompt.js`), `opportunitySynthesis.js`.
- **Company Truth flow:** Sage produces a "who your company is" report the owner **reviews and approves** before any department consumes it. When approved and behind `SAGE_V2_CONTEXT` flag, `config/anthropic.js withTruthSystem()` appends the vetted Company Truth digest to EVERY brand-scoped Claude system prompt.
- **Model:** Claude (with web search); Hermes for some triage.
- **Real actions:** Reads real external sources; writes intelligence/competitor rows. UNVERIFIED reliability at scale.
- **Status:** Largest/most-developed agent. VERIFIED code; multi-phase, some flags default OFF.

### Vision — Visual Intelligence Agent (`id: vision`)
- **Intended role:** Learns the industry's winning visuals so Forge's images look real/on-trend.
- **Actual role:** Studies real reference images (owner-uploaded to `uploads/vision/` + gathered sources), writes `vision_knowledge`, logs `vision_study_runs`, and Forge consults it in-process (`vision_guidance_log`). Controller: `visionController.js`; engine `utils/visionEngine.js`.
- **Model:** Claude vision (per-image ≤5 MB, ≤30 photos/brand).
- **Status:** Phase 1. VERIFIED code; honest empty states.

---

## 3. Cross-cutting / non-department AI components

### Hermes decision brain
- **File:** `config/hermes.js`; consumers listed in §1. Advisory, non-breaking. Does thinking/routing/triage; never writes content. **Status:** VERIFIED wrapper; effect depends on `NOUS_PORTAL_API_KEY`.

### Setup Agent (onboarding)
- **File:** `controllers/setupAgentController.js` + `prompts/setupAgentPrompt.js` (SETUP_AGENT_SYSTEM_PROMPT). Model: Claude (`anthropic`, `MODEL`). Orchestrates brand discovery, campaign/appointment/content/ad/email/feedback setup by delegating into the respective controllers. Malformed AI output → HTTP 502 (never guessed). **Status:** VERIFIED code path; PARTIALLY tested. (Newer Guided Setup Wizard: `controllers/guidedSetupController.js` + `prompts/guidedSetupPrompt.js`, screenshot help analysis.)

### Sales Agent (Zorecho's own inbound demo line)
- **File:** `controllers/salesAgentController.js` + `prompts/salesAgentPrompt.js`. Platform-level (Zorecho selling itself), admin-managed, SEPARATE from per-brand phone agent. Uses platform `SALES_TWILIO_*` env, stores `sales_calls`, config in singleton `sales_agent_config`. Claude for conversation; Twilio `<Gather>` loop; interest scoring + co-pilot + call summary prompts. **Status:** Real code; **UNVERIFIED live** (Twilio spend).

### Email Assistant (Echo watches inboxes)
- **Files:** `controllers/echoEmailController.js`, `utils/emailMonitor.js` (15-min IMAP sweep), `utils/emailAccounts.js`, `utils/emailComposer.js`. Model: Claude for categorize/summarize/draft. Honest failure: AI failure stores message with category `general` and NULL summary — never fabricated. Drafts require owner approve/send. **Status:** VERIFIED code; IMAP/SMTP live delivery UNVERIFIED.

### Personal Assistant (reminders + tasks)
- **File:** `controllers/echoAssistantController.js`. Owner-scoped reminders/tasks CRUD + a voice-command endpoint: raw transcript → Claude parses to structured intent → validated & executed. AI failure → 502, never mocked. Voice events enqueued via `utils/echoVoiceNotifications.js`. **Status:** VERIFIED.

### Autonomous Conversation engine (two-way lead conversations)
- **Files:** `controllers/autonomousConversationController.js` (engine) + `utils/autonomousConversationBrain.js` (Hermes triage) + `prompts/autonomousReplyPrompt.js` (Claude reply). Flow: lead reply → Hermes decides state (`continue|stop|booked|converted`) + buying signal + temperature → Claude writes reply → logged to `leads.conversation_history` + `autonomous_conversations` → temperature updated → on STRONG buying signal, owner alerted by voice + SMS (Twilio) once per conversation. Terminal on book/convert/stop/48h-silent (cron)/owner-takeover. **Invariant:** AI failure never mocks a reply — the turn is skipped. **Status:** VERIFIED code; external send legs (SMS/voice) UNVERIFIED live.

### Conversational Core (experimental)
- **File:** `utils/conversationalCore.js` + `utils/coreLabTools.js`; client `sections/CoreLab.jsx`. **EXPERIMENTAL PROTOTYPE**, behind `ENABLE_CONVERSATIONAL_CORE` flag (OFF by default) + in-memory emergency disable. Hermes intent → read-only tool adapter → Claude reply → flight-recorder trace. **v1 safety: every tool is read-only**; anything that would create/send/publish/delete returns a preview with `requiresApproval: true` and is never executed. **Status:** SIMULATED/PROTOTYPE — not production; disabled by default.

### Autonomous Growth
- **Files:** `controllers/autonomousGrowthController.js`, `controllers/growthController.js` (`prompts/adCreativePrompt.js`). Echo proposes growth actions stored as `growth_actions` with status `proposed`; owner approves. Guardrails + action log surfaced in `sections/Autopilot.jsx` / Echo department "Autonomous Growth". **Status:** Proposal/approval model VERIFIED; approval gate enforced.

---

## 4. Chain of command — intended vs actual

**Intended (per product framing):**
Business profile → department head → agents → work product → review → approval → execution → reporting.

**Actual (per code):**
1. **Business profile / Company Truth** is created in onboarding (brand discovery) and, when approved, injected into Claude system prompts platform-wide via `withTruthSystem()` (flag-gated).
2. **There is no runtime "department head → agent" delegation graph.** Each "agent" maps to a set of conventional feature controllers invoked directly by the client (or by the Setup Agent / schedulers). `agentsController` only *aggregates status* read-only.
3. **Echo orchestration (Hermes)** provides *routing advice* for the conversational surface (which teammate owns a request), not actual task dispatch to worker processes.
4. **Execution** of external actions (ads, posts, calls, emails, SMS) happens inside the individual feature controllers, gated by connection status and — for autonomous/growth actions — by explicit owner approval (`growth_actions.proposed`, draft approve/send).
5. **Reporting** is the read-only aggregation in `agentsController`, Mission Control (`missionControlV2Controller.js`), ROI dashboards, and Sage/Sentinel feeds.

**Breaks / uncertainty to flag for the reviewer:**
- The "team of agents working autonomously" narrative is largely a **UI framing over feature controllers + a status aggregator**; there is no persistent multi-agent task queue.
- Hermes' influence is **advisory and flag/key-dependent**; with no key, the "brain" is silently absent (fallback behavior).
- All genuinely external actions are **UNVERIFIED end-to-end in production** per the global evidence rules.
