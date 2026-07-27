# DATABASE_MAP.md

Database map for the EchoAI / Zorecho platform, prepared for outside architect review.

- **Database engine**: PostgreSQL (accessed through `pg` Pool in `EchoAI/config/db.js`; `DATABASE_URL` connection string). Extension `pgcrypto` is required (`gen_random_uuid()`).
- **Schema source of truth**: raw SQL migration files in `EchoAI/models/*.sql`. There is **no ORM**. Base schema in `EchoAI/models/schema.sql`; incremental migrations `002_*.sql` … `124_*.sql`. Migrations are applied by the runner `EchoAI/utils/runMigrations.js` (see DEPLOYMENT_AND_RECOVERY.md, produced by T001).
- **Tenant model**: Multi-tenant by application-level ownership joins, **not** by Postgres RLS. Almost every table is scoped by `user_id` (owner) and/or `brand_id` (a user's business/brand). Ownership is enforced in app code on every read/write (joins back to `brands`/`users`); there is no database-enforced row isolation. This is a **tenant-isolation risk to review** — see SECURITY_AND_PRIVACY_OVERVIEW.md (T007).
- **Primary keys**: UUID (`gen_random_uuid()`) throughout the core schema. Some later Sage/analytics tables use `BIGSERIAL`/`SERIAL` (see individual migrations).
- **updated_at**: a shared trigger `set_updated_at()` keeps `updated_at` current on core tables.

### How this document was produced (evidence method)
- Table list: every `CREATE TABLE` in `EchoAI/models/*.sql` (≈180 tables).
- Purpose: from the header comment block of the migration that creates each table (quoted/paraphrased) — these are developer comments, treated as intent, not proof of runtime behavior.
- Writers/readers: `grep` of each table name against `EchoAI/controllers`, `EchoAI/utils`, `EchoAI/routes`, `EchoAI/middleware`. The file lists below are **references found** (a file appearing means it contains SQL touching that table); direction (read vs write) was not individually verified per file — treat as "code that touches this table".
- **Critical fields / full column detail**: read the cited migration file for the authoritative column list, constraints, FKs, and indexes. Where a table's key columns are called out below they were read directly; otherwise the migration file is the reference.
- Labels used: **ACTIVE** (clearly referenced by app code), **LOW/NO CODE REFERENCE** (create exists but grep found no controller/util reference — candidate abandoned/duplicate/UNVERIFIED), **DUPLICATE-RISK** (overlaps another table).

---

## 1. Core schema (`models/schema.sql`)

The original 8-table core. Enums defined here: `subscription_tier` (free/starter/growth/pro/enterprise), `billing_cycle`, `payment_status`, `lead_temperature` (tire_kicker/warm/hot), `conversion_status`, `interaction_type`, `integration_platform` (facebook/stripe), `connection_status`.

| Table | Purpose | Critical fields | Code that touches it |
|---|---|---|---|
| `users` | Account/owner root. Auth + tier. | `user_id` (PK UUID), `email` (unique), `password_hash`, `subscription_tier`, `role` (added 009), `preferred_name` (073), `phone` (082), `password_changed_at` (123), `active_brand_id` (085) | 50+ files incl. `authController.js`, `auth.js` (middleware), `adminController.js`, `subscriptionController.js`, `teamController.js` — see §env note. Central table. **ACTIVE** |
| `subscriptions` | Billing state + payment-failure lockout. | `subscription_id`, `user_id` (FK), `subscription_tier`, `payment_status`, `failed_payment_at`, `is_locked`, `locked_at`, Stripe cols (002) | `subscriptionController.js`, `authController.js`, `lockout.js`, `featureGate.js`, `economics.js`, `betaProgram.js`, `usageCapacityController.js`, `healthMonitorController.js`. **ACTIVE** |
| `brands` | A user's business/brand. The primary tenant scope for most features. Carries brand voice, target audience, geo targeting (079), brand type (060: political 076 / real estate 077), online presence (115), taglines (011). | `brand_id` (PK), `user_id` (FK), `brand_name`, `brand_personality`, `target_audience` JSONB, `geo_targeting` JSONB | ~95 files — the most-referenced table in the codebase (see part-1 grep map). **ACTIVE** |
| `leads` | CRM leads per brand. | `lead_id`, `brand_id` (FK), `email`, `phone`, `temperature`, `conversation_history` JSONB, `conversion_status`, geo flag cols | ~40 files incl. `leadController.js`, `crmController.js`, `chatbotController.js`, `followUpController.js`, `smsMarketingController.js`, `emailMarketingController.js`. **ACTIVE** |
| `campaigns` | Marketing/ad campaigns per brand. | `campaign_id`, `brand_id`, `user_id`, `budget`, `cost_per_lead`, `conversion_rate`, `ad_creative_variations` JSONB, Facebook cols (003) | `campaignController.js`, `optimizationController.js`, `roiController.js`, `analyticsController.js`, `scheduler.js`, `capitalFundingController.js`. **ACTIVE** |
| `crm_interactions` | Per-lead (or brand-scoped, 006) interaction log. | `interaction_id`, `lead_id`, `interaction_type`, `interaction_details` JSONB | `crmController.js`, `chatbotController.js`, `leadController.js`, `reportingController.js`. **ACTIVE** |
| `api_integrations` | Encrypted third-party tokens (facebook/stripe enum). `api_token_encrypted` (AES-256-GCM via `utils/encryption.js`). Extended by Facebook OAuth (017/054/088). | `integration_id`, `user_id`, `platform`, `api_token_encrypted`, `connection_status`, unique(user_id,platform) | `facebookOAuthController.js`, `socialController.js`, `campaignController.js`, `guidedSetupController.js`, `setupAgentController.js`, `autopilotController.js`, +others. **ACTIVE** |
| `analytics` | Weekly per-brand performance rows. CTR cols added 063. | `analytics_id`, `brand_id`, `week_date`, `total_spend`, `total_leads`, `cost_per_lead`, `conversions`, `return_on_ad_spend`, unique(brand_id,week_date) | `analyticsController.js`, `roiController.js`, `reportingController.js`, `scheduler.js`, several Sage utils. **ACTIVE** |

---

## 2. Billing, admin, onboarding, teams

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `platform_inquiries` (010) | Demo-request leads from public landing page. | `demoController.js` only. **ACTIVE (narrow)** |
| `tour_progress` (040) | Per-user guided product-tour progress. | `tourController.js`. **ACTIVE** |
| `setup_sessions` (041–044) | AI Setup Agent conversational onboarding session + concurrency lease/fencing token. | `setupAgentController.js`, `guidedSetupController.js`, `setupConsent.js`. **ACTIVE** |
| `guided_setup_progress` (096) | Guided Setup wizard resume point (one row/owner). | `guidedSetupController.js`. **ACTIVE** |
| `team_members` (032) | Workspace staff, roles (`team_role`), status (`team_member_status`). | `teamController.js`, `auth.js`, `crmController.js`, `portfolioController.js`. **ACTIVE** |
| `team_invitations` (032) | Pending staff invites. | `teamController.js`. **ACTIVE** |
| `agencies` / `agency_customers` (025) | White-label agency system. | `whiteLabelController.js`, `whiteLabel.js` (util). **ACTIVE (feature-gated)** |
| `affiliates` / `referrals` (026) | Affiliate program + referral tracking. | `affiliateController.js`, `referralTracking.js`, `goalMetrics.js`. **ACTIVE** |
| `feedback_reports`, `surveys`, `survey_responses` (030) | Customer feedback & survey system. | `feedbackController.js`, `customerIntelligenceController.js`, `selfReview.js`, `demoSeeder.js`. **ACTIVE** |
| `feature_suggestions`, `feature_suggestion_requests` (083) | Product-intelligence capture when Echo is asked for something it can't do. | `featureSuggestions.js`, `featureSuggestionAdminController.js`, `selfReview.js`. **ACTIVE** |
| `beta_settings`, `beta_waitlist`, `beta_feature_usage` (080) | Admin-controlled beta program. | `betaProgram.js`, `betaAdminController.js`, `authController.js`. **ACTIVE** |
| `demo_config` (053/054/090/091) | Singleton demo/sales-presentation config + three-tier demo seeding. | `demoController.js`, `demoSeeder.js`. **ACTIVE** |
| `support_tickets` (046) | Health/support tickets. | `healthMonitorController.js`, `selfReview.js`. **ACTIVE** |
| `health_checks` (046) | Per-brand health-check runs (scheduler/manual). | `healthMonitorController.js`, `missionControlV2Controller.js`, `agentsController.js`, `echoBriefing.js`, `selfReview.js`, `adminController.js`. **ACTIVE** |

**Feature gating (031)**: adds columns/config for tier enforcement (no new standalone table beyond config); enforced in `middleware/featureGate.js` reading `subscriptions`.

---

## 3. Auth / sessions / mobile / push

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `session` (017) | connect-pg-simple session store for OAuth CSRF `state`. Managed by the library, not app SQL. | No direct app SQL references found (managed by connect-pg-simple middleware). **ACTIVE (library-managed)** |
| `refresh_tokens` (027) | Mobile API (/api/v2) refresh tokens. | `mobileAuthController.js`. **ACTIVE (mobile)** |
| `device_tokens` (027) | Mobile FCM device tokens. | `mobilePushController.js`. **ACTIVE (mobile)** |
| `push_subscriptions` (016) | Web Push (PWA) subscriptions for hot-lead alerts. | `pushController.js`, `setupStatus.js`. **ACTIVE** |

---

## 4. Integrations (external connections)

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `google_integrations` (018) | Encrypted Google OAuth tokens (Business Profile, Ads, Analytics, Search Console). | `googleController.js`, `guidedSetupController.js`, `setupAgentController.js`, `setupStatus.js`. **ACTIVE** |
| `google_ad_plans` (045) | Google Ads starter plans (one per brand, Setup Agent). | `googleController.js`, `setupAgentController.js`. **ACTIVE** |
| `seo_content` (018) | Generated SEO content. | `seoController.js`, `customerIntelligenceController.js`. **ACTIVE** |
| `jobber_integrations` (124) | Jobber field-service CRM OAuth connection (one per user). | `jobberController.js`, `guidedSetupController.js`. **ACTIVE (newest)** |
| `webhooks` / `webhook_delivery_logs` (024) | Zapier / outbound webhooks + delivery logs. | `zapierController.js`, `webhookDispatcher.js`, `healthMonitorController.js`. **ACTIVE** |
| `twilio_config` (021) | Per-brand Twilio phone-agent config. | `phoneController.js`, `smsMarketingController.js`, `followUpController.js`, many others. **ACTIVE** |
| Facebook OAuth (017/054/088) | Facebook connection: session store, page selection, per-Page access tokens (`facebook_pages`, page tokens). Stored via `api_integrations` + page-token columns. | `facebookOAuthController.js`, `socialController.js`. **ACTIVE (staging connect not yet tested — see global rules)** |

---

## 5. Social, content, video, images, media

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `social_accounts` (012) | Connected social platform accounts (enum `social_platform`). | `socialController.js`, `contentCalendarController.js`, `healthMonitorController.js`, `setupAgentController.js`, `realEstateAutomation.js`, `voiceContentController.js`. **ACTIVE** |
| `social_posts` (012, +065 retry, +078 source, +099 video) | Scheduled/published social posts (enum `social_post_status`), retry + source-key dedup + optional uploaded media. | ~18 files incl. `socialController.js`, `autopilotController.js`, `contentCalendarController.js`, `forgeDirector.js`, `realEstateAutomation.js`, `roiController.js`. **ACTIVE** |
| `content_calendars` (028) | Monthly AI-planned posting plan per brand (`content_calendar_status`). | `contentCalendarController.js`, `socialController.js`, `agentsController.js`, `setupAgentController.js`. **ACTIVE** |
| `content_calendar_settings` (070/071) | Per-brand posting-window + per-platform frequency overrides. | `contentCalendarController.js`. **ACTIVE** |
| `video_scripts` (013) | AI video scripts (`video_script_status`). | `videoContentController.js`, `agentsController.js`. **ACTIVE** |
| `images` (015/036) | AI-generated marketing images (`image_status`) + content brief/style notes. | `imageController.js`, `visionEngine.js`, `agentsController.js`, `missionControlV2Controller.js`. **ACTIVE** |
| `ad_creatives` (029) | AI ad-creative packages (5 per generation). | `adCreativeStudioController.js`, `agentsController.js`, `setupAgentController.js`, `realEstateAutomation.js`, others. **ACTIVE** |
| `stored_files` (113) | Durable DB copy of served upload files (ephemeral-FS workaround on Railway). | `storedFiles.js`. **ACTIVE (infra workaround)** |
| `voice_content_sessions` / `voice_content_drafts` (092) | Voice-driven hands-free content creation flow. | `voiceContentController.js`. **ACTIVE** |

---

## 6. Email subsystems (note: TWO email-campaign systems co-exist)

**DUPLICATE-RISK**: there are two separate email-campaign schemas: the earlier `email_campaigns`/`email_sends` (014) and the later `email_marketing_*` (037). Both are referenced by code; the reviewer should confirm which is the live path per feature.

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `email_campaigns` (014) | AI email campaigns (`email_campaign_status`). | `emailCampaignController.js`, `missionControlV2Controller.js`, `roiController.js`, `echoSuggestions.js`. **ACTIVE** |
| `email_sends` (014, +066 attempts) | Per-recipient send rows + failure/attempt tracking. | `emailCampaignController.js`, `missionControlV2Controller.js`, `roiController.js`. **ACTIVE** |
| `email_marketing_campaigns` (037, +067) | One-time blasts + drip sequences (`email_marketing_campaign_type`, `_status`). | `emailMarketingController.js`, `customerIntelligenceController.js`, `roiDashboardController.js`, `selfReview.js`, `setupAgentController.js`, `setupStatus.js`. **ACTIVE** |
| `email_marketing_emails` (037) | Individual emails within a marketing campaign. | `emailMarketingController.js`. **ACTIVE** |
| `email_marketing_recipients` (037, +071/072 errors) | Per-recipient delivery status (`email_marketing_delivery_status`) + permanent/transient error classification. | `emailMarketingController.js`, `customerIntelligenceController.js`, `roiDashboardController.js`, `selfReview.js`. **ACTIVE** |
| `email_opt_outs` (037) | Email suppression list. | `emailMarketingController.js`. **ACTIVE** |
| `email_accounts` (084) | Echo Email Assistant multi-account IMAP/SMTP (encrypted creds). | `emailAccounts.js`, `echoEmailController.js`, `emailMonitor.js`, `echoCompanionController.js`, `guidedSetupController.js`. **ACTIVE** |
| `email_messages` (084) | Cached inbox message intelligence. | `echoEmailController.js`, `emailMonitor.js`, `coreLabTools.js`, `echoCompanionController.js`. **ACTIVE** |
| `email_drafts` (084) | Drafts awaiting owner approval. | `echoEmailController.js`, `emailComposer.js`. **ACTIVE** |

---

## 7. SMS

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `sms_campaigns` (035) | Bulk AI SMS campaigns (`sms_campaign_status`). | `smsMarketingController.js`, `healthMonitorController.js`, `echoSuggestions.js`, `setupStatus.js`. **ACTIVE** |
| `sms_messages` (035, +068 error) | Per-message SMS rows (`sms_direction`) + failure reasons. | `smsMarketingController.js`, `customerIntelligenceController.js`, `roiDashboardController.js`, `selfReview.js`, `healthMonitorController.js`. **ACTIVE** |
| `sms_opt_outs` (035) | SMS opt-out list. | `smsMarketingController.js`, `smsOptOut.js`. **ACTIVE** |

---

## 8. Phone / calls / chatbot / sales

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `calls` (021) | Phone-agent call records (`call_direction`). | `phoneController.js`, `crmController.js`, `followUpController.js`, `roiDashboardController.js`, `teamController.js`. **ACTIVE** |
| `chatbot_config` (022) | Per-brand website-chatbot config. | `websiteChatbotController.js`, `setupStatus.js`, `echoSuggestions.js`. **ACTIVE** |
| `chatbot_sessions` (022) | Website chatbot conversation sessions. | `websiteChatbotController.js`, `agentsController.js`, `echoMemoryController.js`. **ACTIVE** |
| `sales_scripts` (023) | AI sales script generator output. | `salesScriptController.js`, `demoSeeder.js`. **ACTIVE** |
| `sales_calls` (047) | Inbound demo calls to Zorecho's OWN sales line (three-way call). | `salesAgentController.js`. **ACTIVE** |
| `sales_agent_config` (047) | Zorecho sales-agent config. | `salesAgentController.js`. **ACTIVE** |

---

## 9. Appointments, follow-ups, autonomous conversations

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `availability_schedules` / `availability_blocks` (033) | Per-brand booking availability rules & blocks. | `appointmentController.js` (+ `availability_schedules` also read by `contentCalendarController.js`, `voiceContentController.js`, `timeOfDay.js`, `setupStatus.js`). **ACTIVE** |
| `appointments` (033) | Booked appointments (`appointment_status`). | `appointmentController.js`, `followUpController.js`, `echoVoiceReminders.js`, `roiDashboardController.js`, many others. **ACTIVE** |
| `follow_up_sequences` (034) | Automated per-lead multi-step sequences (`follow_up_status`). | `followUpController.js`, `autonomousGrowthController.js`, `echoVoiceReminders.js`, `healthMonitorController.js`, others. **ACTIVE** |
| `sequence_touchpoints` (034) | Per-step touchpoints (`follow_up_channel`, `touchpoint_status`). | `followUpController.js`, `echoVoiceReminders.js`, `healthMonitorController.js`, `demoSeeder.js`. **ACTIVE** |
| `autonomous_conversations` (086) | Two-way autonomous conversation state when a lead replies (SMS/email/chat). | `autonomousConversationController.js`, `missionControlV2Controller.js`, `objectionsMining.js`. **ACTIVE** |

---

## 10. Echo companion / memory / personal assistant / voice

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `echo_companion` (048) | Per-user post-setup activation journey. | `echoCompanionController.js`, `agentsController.js`, `echoBriefing.js`. **ACTIVE** |
| `echo_memory` (049) | Echo persistent memory. | `echoMemoryController.js`, `echoContext.js`, `agentsController.js`, `missionControlV2Controller.js`. **ACTIVE** |
| `growth_settings` / `growth_actions` (049) | Autonomous Growth Mode guardrails + action log. | `autonomousGrowthController.js`, `growthController.js`, `agentsController.js`. **ACTIVE** |
| `echo_learnings`, `echo_learning_signals`, `echo_open_questions` (055/094) | Deep memory + Learning Engine (owner-taste signals). | `learningEngine.js`, `autopilotController.js`, `echoBriefing.js`, `leadOutcome.js`, `selfReview.js`, `skipGates.js`. **ACTIVE** |
| `echo_owner_profile`, `echo_relationship_profiles` (055) | Owner profile + relationship profiles. | `echoContext.js`, `echoMemoryController.js`, `echoProfileController.js`, `capitalFundingController.js`. **ACTIVE** |
| `growth_brand_state`, `growth_daily_summaries` (056) | Stronger autonomous growth state + daily summaries. | `autonomousGrowthController.js`, `followUpController.js`. **ACTIVE** |
| `echo_suggestions` (059) | Proactive channel/tool suggestions in weekly briefing. | `echoSuggestions.js`. **ACTIVE** |
| `echo_reminders`, `echo_tasks` (081) | Echo Personal Assistant reminders + tasks. | `echoPersonal.js`, `echoAssistantController.js`, `echoBriefing.js`. **ACTIVE** |
| `echo_voice_notifications` (052) | Queued spoken notifications. | `echoVoiceNotifications.js`, `echoVoiceController.js`, `echoPersonal.js`, `diagnosticsController.js`. **ACTIVE** |
| `voice_learned_phrases` (075) | Per-owner learned speech→action phrases. | `echoVoiceController.js`. **ACTIVE** |
| Echo voice settings (052) | Per-owner voice-settings blob + profile (stored via 052 tables/columns). | `echoVoiceController.js`, `echoVoiceReminders.js`. **ACTIVE** |

---

## 11. Portfolio / capital / customer intelligence / optimization

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `portfolio_health_scores` (058) | Owner-scoped portfolio health across all brands. | `portfolio.js`. **ACTIVE** |
| `cross_business_intelligence` (058) | Cross-business insights across an owner's brands. | `portfolioController.js`, `scheduler.js`. **ACTIVE** |
| `funding_opportunities`, `grant_applications`, `opportunity_briefings` (057) | Scout capital/grant opportunity intelligence. | `capitalFundingController.js`. **ACTIVE** |
| `customer_intelligence` (039) | Enterprise cross-channel customer intelligence synthesis. | `customerIntelligenceController.js`, `agentsController.js`, `echoBriefing.js`, `sageBriefingController.js`, `demoSeeder.js`. **ACTIVE** |
| `applied_recommendations` (039) | Recommendations applied from intelligence. | `customerIntelligenceController.js`. **ACTIVE** |
| `competitor_intelligence` / `optimization_history` (007) | Competitor analysis reports + AI optimization history. | `optimizationController.js`, `adminController.js`, `agentsController.js`, `customerIntelligenceController.js`, others. **ACTIVE** |
| `roi_snapshots` (019) | Weekly per-brand ROI snapshot. | `roiController.js`, `demoSeeder.js`. **ACTIVE** |
| `roi_advanced_snapshots` (038) | Multi-channel dollar-attribution snapshots. | `roiDashboardController.js`, `agentsController.js`, `goalMetrics.js`, `portfolio.js`, `sageBriefingController.js`, others. **ACTIVE** |
| `reviews` (020) | Reputation-management reviews (Google/Facebook, etc). | `reputationController.js`, `companyTruth.js`, `missionControlV2Controller.js`, `demoSeeder.js`. **ACTIVE** |
| `supporters` (política) | Political-campaign supporters (076). | `supporterController.js`, `goalMetrics.js`, `echoBriefing.js`. **ACTIVE (brand-type gated)** |

---

## 12. Goals & alerts

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `brand_goals` (060) | Per-brand target goals/KPIs (brand-type aware). | `goalController.js`, `goalMetrics.js`, `goalAlerts.js`, `agentsController.js`, `echoBriefing.js`, `optimizationController.js`, `missionControlV2Controller.js`, `diagnosticsController.js`. **ACTIVE** |
| `goal_snapshots` (060, +061 nullable) | Daily percent-to-goal snapshots (NULL = no data). | `goalMetrics.js`, `goalAlerts.js`, `echoBriefing.js`, `missionControlV2Controller.js`, `diagnosticsController.js`. **ACTIVE** |
| `goal_alert_log` (062/064) | Dedup/claim log + owner-facing management of daily goal alerts. | `goalAlerts.js`, `goalController.js`, `agentsController.js`, `missionControlV2Controller.js`. **ACTIVE** |

---

## 13. Autopilot / Forge (creative)

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `autopilot_settings` (093) | Weekly cadence config (Nova posts-only after 103/107). | `autopilotController.js`. **ACTIVE** |
| `autopilot_batches` (093) | Weekly generated batches for owner review. | `autopilotController.js`, `echoBriefing.js`, `sageBriefingController.js`. **ACTIVE** |
| `autopilot_batch_items` (093, +100 video) | Per-item drafts in a batch (ads zeroed out per 103/107 — posts only). | `autopilotController.js`, `echoBriefing.js`, `forgeDirector.js`. **ACTIVE** (note: ad drafting deprecated; see migrations 103/107) |
| `forge_creative_briefs` (108/110) | Forge creative-director briefs + per-item hybrid creative mode. | `forgeDirector.js`, `autopilotController.js`. **ACTIVE** |

---

## 14. Sage (Industry Intelligence) — V1 and V2

Sage is the largest subsystem by table count. **V1** (069+) is active. **V2** (116–121) is **additive and flag-gated OFF by default** (`SAGE_V2_*` env flags — see ENVIRONMENT_AND_INTEGRATIONS.md); those tables may be **dormant/unexercised in production** unless flags are enabled — treat V2 tables as **UNVERIFIED at runtime** unless a flag is confirmed on.

**Sage V1 & pattern intelligence:**

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `sage_intelligence_profiles` (069) | Per-brand industry intelligence profile. | `sageController.js`, `sageContext.js`, `companyTruth.js`, `missionControlV2Controller.js`, `diagnosticsController.js`, `echoSectionBriefController.js`. **ACTIVE** |
| `sage_intelligence_feed` (069, +101/102 dedup) | "Latest Intelligence" feed, content-key dedup, owner-dismiss. | `intelStore.js`, `sageController.js`. **ACTIVE** |
| `sage_competitors` (069/087) | Confirmed competitors per brand. | `sageController.js`, `companyTruth.js`, `competitorAdSpyController.js`, `agentsController.js`, `skipGates.js`. **ACTIVE** |
| `sage_research_runs` (069) | Research run log. | `sageController.js`, `diagnosticsController.js`. **ACTIVE** |
| `sage_submissions` (069) | Owner submissions to Sage. | `sageController.js`. **ACTIVE** |
| `sage_alert_log` (069) | Sage alert dedup. | `sageController.js`, `diagnosticsController.js`. **ACTIVE** |
| `sage_pattern_campaigns` / `sage_pattern_insights` (109) | Pattern Intelligence Engine (studies public marketing). | `patternIntelligence.js`, `forgeDirector.js`. **ACTIVE** |
| `company_truth_reports` (111/114) | Versioned Company Intelligence Report from real brand data (background-generated, failed-status support). | `companyTruthController.js`, `companyContext.js`, `companyTruth.js`, `sageBriefingController.js`, `sagePhase5Controller.js`, `dataQualitySentry.js`, `echoBriefing.js`, `skipGates.js`. **ACTIVE** |

**Sage V2 (116–121) — flag-gated, default OFF:**

| Table (migration) | Purpose | Code that touches it | Note |
|---|---|---|---|
| `sage_context_stats`, `sage_weekly_briefings` (116) | Phase 1 context stats + weekly briefings. | `companyContext.js`; `sageBriefingController.js`. | Behind `SAGE_V2_CONTEXT` / `SAGE_V2_WEEKLY_BRIEFING` |
| `sage_intel_items`, `sage_job_queue`, `sage_job_hashes`, `sage_data_quality_flags` (117) | Phase 2 intel store, job queue, dedup hashes, DQ sentry. | `intelStore.js`, `jobQueue.js`, `inputHash.js`, `dataQualitySentry.js`, `companyTruth.js`, `opportunitySynthesis.js`, `sagePhase5Controller.js`. | Behind `SAGE_V2_INTEL_STORE`/`_JOB_QUEUE`/`_SKIP_GATES`/`_DQ_SENTRY` |
| (Phase 3, 118) | Outcome capture + attribution columns (additive, nullable). | column-level; see migration. | Flags OFF = byte-identical |
| `sage_offers`, `brand_constraints`, `sage_memory` (119) | Phase 4 offers registry, business constraints, executive memory. | `sagePhase4Context.js`, `sagePhase4Controller.js`, `sagePhase5Controller.js`, `sageStrategy.js`, `companyTruth.js`, `opportunitySynthesis.js`, `directiveBus.js`. | Behind `SAGE_V2_OFFERS`/`_EXEC_MEMORY` |
| `sage_opportunities`, `sage_opportunity_evidence`, `sage_opportunity_deps`, `sage_directives`, `sage_decisions`, `sage_change_diagnostics` (120) | Phase 5 opportunity queue, directive bus, decisions, change diagnostics. | `opportunitySynthesis.js`, `sagePhase5Controller.js`, `directiveBus.js`, `sageSelfEval.js`, `sageStrategy.js`, `echoBriefing.js`, `changeDiagnostics.js`. `sage_opportunity_deps` — **NO CODE REFERENCE found** (candidate unused). | Behind `SAGE_V2_OPPORTUNITIES`/`_DIRECTIVES` |
| `sage_channel_scorecards`, `sage_forecasts`, `sage_strategies`, `sage_strategy_bet_opportunities`, `sage_debates`, `sage_self_eval` (121) | Phase 6 scorecards, forecasts, top-3-bets strategy, executive debate, self-eval. | `channelScorecards.js`, `sageForecasts.js`, `sageStrategy.js`, `sageSelfEval.js`. | Behind `SAGE_V2_SCORECARDS` (+ related) |

---

## 15. Vision (Visual Intelligence Agent)

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `vision_knowledge` (105) | Learned visual knowledge. | `visionController.js`, `visionEngine.js`, `agentsController.js`. **ACTIVE** |
| `vision_study_runs` (105) | Study-run log. | `visionController.js`, `visionEngine.js`, `agentsController.js`. **ACTIVE** |
| `vision_guidance_log` (105) | Guidance applied log. | `visionController.js`, `visionEngine.js`, `agentsController.js`. **ACTIVE** |
| `vision_reference_images` (106/112) | Reference image library; image bytes stored IN DB (ephemeral-FS workaround). | `visionController.js`, `visionEngine.js`, `visionFiles.js`, `autopilotController.js`, `companyTruth.js`, `echoSuggestions.js`. **ACTIVE** |

---

## 16. Real estate & political brand types

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `property_listings`, `property_leads` (077) | Real-estate brand type: listings + property leads. | `propertyController.js`, `realEstateAutomation.js`, `goalMetrics.js`, `echoBriefing.js`. **ACTIVE (brand-type gated)** |
| `open_houses`, `open_house_attendees` (077) | Open-house events + attendees. | `propertyController.js`, `realEstateAutomation.js`, `echoBriefing.js`. **ACTIVE (brand-type gated)** |
| `supporters` (076) | Political-campaign supporter CRM (see §11). | `supporterController.js`. **ACTIVE (brand-type gated)** |

---

## 17. Competitor website / ad spy

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `competitor_websites` (089) | Owner-added competitor website URLs per brand. | `competitorSiteController.js`, `scheduler.js`. **ACTIVE** |
| `competitor_website_changes` (089) | Meaningful per-site changes detected by Scout. | `competitorSiteController.js`, `skipGates.js`. **ACTIVE** |
| `competitor_website_digests` (090) | Weekly per-brand digest of website changes. | `competitorSiteController.js`. **ACTIVE** |
| `competitor_ads` / `competitor_ad_reports` (087) | Competitor Ad Spy (Scout, Enterprise) — Meta ad library etc. | `competitorAdSpyController.js`, `visionEngine.js`, `voiceContentController.js`, `sageBriefingController.js`. **ACTIVE (Enterprise)** |

---

## 18. Collaboration bus, self-review, brand-discovery, misc

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `department_messages` (122) | Department Collaboration Architecture — Stage 0 (foundation, "dark"/additive). | `collaborationBus.js` only. **ACTIVE but foundation-only (dark launch)** — likely not driving user-visible behavior yet; verify. |
| `self_review_reports` / `self_review_items` (095) | Echo weekly admin-only platform self-review. | `selfReview.js`, `selfReviewAdminController.js`. **ACTIVE (admin)** |
| `brand_discovery_sessions` (004) | Three-part brand-discovery conversation state. | `brandDiscoveryController.js`, `companyTruth.js`, `setupAgentController.js`, `adCreativeStudioController.js`. **ACTIVE** |
| `campaign_events` | Campaign event log. | `goalMetrics.js`, `echoBriefing.js`, `supporterController.js`. **ACTIVE** |

---

## 19. AI cost / usage / quota monitoring

| Table (migration) | Purpose | Code that touches it |
|---|---|---|
| `ai_settings` (096) | Admin-tunable AI switches/budgets (key/value overrides). | **NO controller/util reference found** by grep — likely read via a config helper (`config/aiControls.js`) not caught by table-name grep. **VERIFY** (candidate ACTIVE-via-config or abandoned). |
| `ai_usage_log` (096, +097/098 UUID fixes) | Central AI usage ledger (LLM calls; extended 104 to voice/telephony/SMS/email/search). | `aiUsage.js`, `economics.js`, `sageSelfEval.js`, `usageCapacityController.js`. **ACTIVE** |
| `ai_budget_alerts` (096) | Budget-alert dedup. | `aiBudget.js`, `aiControlAdminController.js`. **ACTIVE** |
| `api_quota_snapshots` / `api_quota_alert_log` (068) | Sentinel third-party API credit/quota monitoring. | `apiQuotaMonitor.js`, `selfReview.js`, `diagnosticsController.js`. **ACTIVE** |

> **Note on `ai_settings`**: table-name grep returned no controller/util hits. Cost/AI switches are resolved through `config/aiControls.js` (resolution order: DB override → env → default per migration 096 comment). The reviewer should confirm whether `ai_settings` is actually read (likely yes, via a config accessor) — see AI_AND_INFRASTRUCTURE_COST_MAP.md (T007).

---

## 20. Tables with NO/low direct code reference (review candidates)

Found by grep against controllers/utils/routes/middleware; a create exists but no direct table-name SQL reference was located. May be: (a) accessed only via a helper the grep missed, (b) library-managed, or (c) genuinely abandoned. **Do not assume abandoned without deeper check.**

| Table | Likely explanation |
|---|---|
| `session` (017) | Managed by connect-pg-simple middleware, not app SQL. **NOT abandoned.** |
| `ai_settings` (096) | Accessed via `config/aiControls.js` config accessor (indirect). **Verify.** |
| `sage_opportunity_deps` (120) | Sage V2 Phase 5 dependency edges — flag-gated + no reference found. **Candidate unused / UNVERIFIED.** |

All other ≈177 tables have at least one direct code reference (see sections above).

---

## 21. Enums (types)

Defined across `schema.sql` + migrations (050 adds accountability enum values). Full list:
`subscription_tier`, `billing_cycle`, `payment_status`, `lead_temperature`, `conversion_status`, `interaction_type`, `integration_platform`, `connection_status`, `social_platform`, `social_post_status`, `content_calendar_status`, `video_script_status`, `image_status`, `email_campaign_status`, `email_marketing_campaign_type`, `email_marketing_status`, `email_marketing_delivery_status`, `sms_campaign_status`, `sms_direction`, `appointment_status`, `follow_up_channel`, `follow_up_status`, `touchpoint_status`, `call_direction`, `team_role`, `team_member_status`, `user_role`.

(Migration 050 `ALTER TYPE ... ADD VALUE` extends enums for the Employee Accountability CRM before 051 uses them.)

---

## 22. Data retention, seed, and sample data

- **No automated retention/TTL logic found** at the schema level (no partitioning, no `DELETE`-by-age triggers in migrations). Retention is effectively "keep forever" unless a controller deletes. **Review candidate** (logs like `ai_usage_log`, `sage_intelligence_feed`, `health_checks` grow unbounded).
- **Seed data**: `EchoAI/utils/demoSeeder.js` seeds a demo brand (three tiers) and sample rows across many tables (leads, campaigns, analytics, social_posts, roi_snapshots, surveys, etc.). `EchoAI/utils/adminSeeder.js` seeds the admin user/subscription. These are the closest thing to seed files (no `.sql` seed files).
- Sanitized sample records: see SANITIZED sample data section of the master package (spec §19) — not included in this document to avoid customer data.

---

## 23. Known duplicate / overlapping structures (for the reviewer)

- **Email campaigns**: `email_campaigns`/`email_sends` (014) **vs** `email_marketing_*` (037) — two generations of the same feature. Confirm which is live per UI path.
- **Intelligence feed / intel store**: V1 `sage_intelligence_feed` **vs** V2 `sage_intel_items` (117) — parallel implementations; V2 flag-gated OFF.
- **Company Truth vs Sage intelligence profiles**: `company_truth_reports` (111) overlaps conceptually with `sage_intelligence_profiles` (069). Both active; different lifecycles.
- **ROI**: `roi_snapshots` (019) vs `roi_advanced_snapshots` (038) — simple vs multi-channel attribution; both active.
- **Autopilot ad drafting**: `autopilot_batch_items` still has ad columns, but ads are deprecated for Autopilot (migrations 103/107 zero them out; Atlas/Ad Campaigns owns ads). Dead-ish columns.
</content>
</invoke>
