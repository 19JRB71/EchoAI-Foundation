# FEATURE STATUS MATRIX

**Package:** ZORECHO_FULL_SYSTEM_REVIEW_PACKAGE_2026-07-24
**Scope:** Every major platform subsystem in the EchoAI/Zorecho codebase.
**Method:** Each row was verified against the CURRENT code — the route mount was
confirmed in `EchoAI/server.js`, the controller/route files were confirmed to
exist in `EchoAI/routes/` and `EchoAI/controllers/`, the client section was
confirmed in `EchoAI/client/src/sections/` (or `onboarding/`, `missioncontrol/`,
`voice/`), and the migration was confirmed in `EchoAI/models/`.

## How to read the status labels

Per the review global rules, status is one of:

- **Fully functional and verified** — code path + evidence + an automated test
  that actually exercises the behavior. Reserved for internal behavior only;
  external side-effects are never marked this way without production proof.
- **Functional but not fully tested** — full code path exists and is mounted, but
  the intended external result has NOT been verified end-to-end.
- **Partially implemented** — some of the intended behavior exists; parts are
  missing, dark, or flag-gated off.
- **Frontend only / Backend only** — only one half is present/wired.
- **Real but untested** — external-action code exists and calls a real API, but
  no evidence the external effect actually occurred (default for FB publish,
  Twilio, Stripe live, email sends, web-push, Google APIs, ElevenLabs, images —
  see `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md`).
- **UNVERIFIED / UNKNOWN** — cannot prove it works from code alone.

> Evidence note: the automated suites (server `EchoAI/test/*.test.js`, client
> vitest) were last reported passing 2026-07-24 in the Replit dev environment
> (~948 server + ~385 client). A passing unit test proves internal logic, NOT
> that a live external action fires. Google OAuth was verified working on staging
> 2026-07-23 by the CEO; Facebook staging connect is not yet tested.

---

## Core platform

| Feature | Intended purpose | Status | Frontend file | Backend (route → controller) | DB dependency | Integration dependency | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| Authentication / accounts | Signup, login, JWT sessions, password change, lockout | Functional but not fully tested | `client/src/sections/Login.jsx` | `/api/auth` → `authController.js` | `schema.sql` users, `123_password_changed_at.sql` | none | Lockout + `password_changed_at` iat-reject logic is subtle (see memory `echoai-password-change.md`) | `test/changePassword.test.js`, auth-related suites | Manual login/lockout/password-change on staging |
| Feature gating & tiers | Starter/Pro/Enterprise gating + seat billing | Functional but not fully tested | `client/src/lib/tiers.js`, `components/FeatureGate.jsx` | `middleware/featureGate.js`, `config/plans.js`, `config/tiers.js` | `002_stripe_billing.sql`, `031_feature_gating.sql` | Stripe | Client mirror (`tiers.js`) must stay in sync w/ backend `SECTION_GATES` | gating suites | Manual per-tier access checks |
| Billing / subscriptions | Stripe subscriptions, seat billing, upgrade/downgrade | Real but untested (live Stripe) | `sections/billing/Billing.jsx` | `/api/subscriptions` → `subscriptionController.js` | `002_stripe_billing.sql` | Stripe | Webhook raw-body bypass fragile; live charges unverified | `test/subscriptionPublicConfig.test.js` + others | Stripe test-mode end-to-end on staging |
| Team & roles | Staff invites, workspace roles, seat sync | Functional but not fully tested | `sections/team/TeamManagement.jsx` | `/api/team` → `teamController.js` | `032_team_members.sql` | Stripe (seat sync) | Seat resync coupling (memory `echoai-seat-billing-sync.md`) | team suites | Invite + role + seat-billing on staging |
| Admin panel | Multi-tenant admin: customers, economics, health, beta | Functional but not fully tested | `client/src/admin/*.jsx` | `/api/admin` → `adminController.js`, `economicsAdminController.js`, `betaAdminController.js` | `009_admin_roles.sql`, `080_beta_program.sql` | none | Admin bypasses all gates by design | admin suites | Manual admin walkthrough |
| Mission Control | Daily strategic brief + team roll-up | Functional but not fully tested | `missioncontrol/MissionControlV2.jsx` | `missionControlV2Controller.js`, `/api/agents` | multiple | Anthropic | Two versions present (`MissionControl.jsx` + `MissionControlV2.jsx`) — see technical debt | `MissionControl.*.test.jsx` (client) | Manual review |

## Onboarding

| Feature | Intended purpose | Status | Frontend file | Backend | DB dependency | Integration | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| Guided Setup Wizard | Milestone new-customer front door | Functional but not fully tested | `onboarding/guided/GuidedSetupWizard.jsx` | `/api/guided-setup` → `guidedSetupController.js` | `096_guided_setup.sql` | FB/Google OAuth, email | Live connection probes return "unknown" on failure by design | `test/guidedSetup.test.js`, client tests | Full first-hour walkthrough on staging |
| Setup Agent | Embedded AI business-profile builder | Functional but not fully tested | `onboarding/SetupAgent.jsx` | `/api/setup-agent` → `setupAgentController.js` | `041–044 setup_agent*.sql` | Anthropic | Token-fenced lease + idempotency complex | `test/setupAgent.e2e.test.js` (AI stubbed) | Manual run w/ real AI |
| Brand discovery | Auto-research business from name/website | Functional but not fully tested | `sections/BrandDiscovery.jsx` | `/api/brands` → `brandDiscoveryController.js` | `004_brand_discovery.sql`, `111_company_truth.sql` | Anthropic web search | Fields can be JSON objects (memory `echoai-brand-field-shapes.md`); auto-save-on-confirm added 2026-07-24 | brand suites | Manual discovery run |
| Voice calibration | Optional voice profile before onboarding | Partially implemented | `onboarding/VoiceCalibration.jsx` | `/api/voice`, `voiceSettings` | `075_voice_learned_phrases.sql` | ElevenLabs/OpenAI TTS | Mic blocked in preview iframe | `voice/calibration.test.js` | Manual on real browser |

## Marketing / advertising (Echo, Atlas, Nova)

| Feature | Intended purpose | Status | Frontend file | Backend | DB dependency | Integration | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| Ad campaigns | Facebook ad campaigns + live performance | Real but untested (FB Graph) | `sections/Campaigns.jsx` | `/api/campaigns` → `campaignController.js` | `003_facebook_campaign.sql` | Facebook Marketing API | No FB token → no-op; live ad launch unverified | campaign suites | Live FB test campaign |
| Ad Creative Studio | AI ad-creative packages | Functional but not fully tested | `sections/AdStudio.jsx` | `/api/ad-studio` → `adCreativeStudioController.js` | `029_ad_creatives.sql` | Anthropic, image gen | Text/creative gen only; publish handled by campaigns | — | Manual gen |
| Social media | Scheduled multi-platform posts; cron publishes | Real but untested (FB publish) | `sections/SocialMedia.jsx`, `social/*` | `/api/social` → `socialController.js` | `012_social_media.sql`, `065_social_post_retry.sql`, `078/099` | Facebook Graph | Publish retry only on transient errors (memory `echoai-publish-retry.md`); other platforms status uncertain | `test/publishPostNow.test.js` | Live publish on staging |
| Content calendar | AI month of scheduled posts | Functional but not fully tested | `sections/social/ContentCalendar.jsx` | `/api/content-calendar` → `contentCalendarController.js` | `028/070/071` content_calendar | Anthropic | Timezone→UTC scheduling subtle | `test/contentCalendarDstCalendar.test.js` | Manual schedule + wait for publish |
| Autopilot Mode | Weekly AI content+ad batch → approval queue | Functional but not fully tested | `sections/Autopilot.jsx` | `/api/autopilot` → `autopilotController.js` | `093/100/103/107 autopilot*.sql`, `094 learning_engine` | Anthropic, FB | Depends on Learning Engine cron | autopilot suites | Manual batch + approval |
| Autonomous Growth | Daily guardrail-bounded autonomous actions | Functional but not fully tested | `companion/EchoBrain.jsx`, `sections` | `/api/autopilot`, `autonomousGrowthController.js` | `056_autonomous_growth.sql` | FB | Enforces guardrails incl. geo (memory `echoai-autonomous-growth.md`) | growth suites | Careful staged test (spends money if live) |
| Video content | AI video script packages | Functional but not fully tested (text) | `sections/VideoContent.jsx` | `/api/video` → `videoContentController.js` | `013_video_scripts.sql` | Anthropic | Script generation only — no actual video rendering | — | Manual gen |
| Image studio | AI prompt → image generation | Real but untested (OpenAI images) | `sections/ImageStudio.jsx`, `image/*` | `/api/images` → `imageController.js` | `015_images.sql`, `036_image_studio_enrich.sql`, `113_stored_files.sql` | OpenAI `gpt-image-1` | dall-e-3 retired; b64 persisted at gen (memory `echoai-openai-image-api.md`) | `test/imageReference.test.js` | Manual gen (spends) |
| Email marketing | AI campaigns + drip sequences | Real but untested (SMTP send) | `sections/EmailMarketing.jsx`, `email/*` | `/api/email-marketing` → `emailMarketingController.js` | `014/037 email*`, `066/067/071/072` | SMTP (nodemailer) | Failure classify permanent vs transient | `email-campaign-sends.md` lessons; client tests | Live send to test inbox |
| SMS marketing | Two-way SMS over brand Twilio number | Real but untested (Twilio) | `sections/SmsMarketing.jsx` | `/api/sms` → `smsMarketingController.js` | `035_sms_marketing.sql`, `068_sms_message_error.sql` | Twilio | Opt-out handling; error classification | `SmsMarketing.*.test.jsx` (client) | Live SMS to test number |
| Google & SEO | Google OAuth reads + SEO content generator | Real but untested (Google APIs) | `sections/GoogleSeo.jsx`, `googleseo/*` | `/api/google`, `/api/seo` → `googleController.js`, `seoController.js` | `018_google_seo.sql`, `045_google_ad_plans.sql` | Google OAuth/APIs | Google OAuth verified on staging 2026-07-23; API reads unverified | seo suites | Live Google account read |
| Reputation | Review fetch + reply posting | Real but untested | `sections/Reputation.jsx`, `reputation/*` | `/api/reputation` → `reputationController.js` | `020_reviews.sql` | Google reviews | Reply posting unverified | reputation suites | Live review reply |

## CRM / sales (Pulse, Voice)

| Feature | Intended purpose | Status | Frontend file | Backend | DB dependency | Integration | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| Leads | Lead capture, temperature, status | Functional but not fully tested | `sections/Leads.jsx`, `LeadDetail.jsx` | `/api/leads` → `leadController.js` | `005_lead_conversion.sql` | none | App-code dedup, no table-wide unique (memory `echoai-leads-dedup.md`) | lead suites | Manual lead lifecycle |
| CRM / accountability | Sales-rep console, call monitoring, queue | Functional but not fully tested | `sections/crm/*` | `/api/crm` → `crmController.js` | `050/051 accountability*.sql` | Twilio (calls) | Owner/admin vs manager guard split (memory `echoai-crm-monitoring-gate.md`) | crm suites | Manual multi-role test |
| Follow-up sequences | Automated nurture sequences | Functional but not fully tested | `sections/FollowUps.jsx` | `/api/follow-ups` → `followUpController.js` | `034_follow_up_sequences.sql` | email/SMS | Depends on scheduler firing | follow-up suites | Manual sequence + wait |
| Appointments | Booking + calendar | Functional but not fully tested | `sections/Appointments.jsx` | `/api/appointments` → `appointmentController.js` | `033_appointments.sql` | Google Calendar | Advisory-lock serialized writes (memory `appointments-booking.md`) | appointment suites | Manual booking |
| Phone agent | Twilio AI receptionist | Real but untested (Twilio voice) | `sections/PhoneAgent.jsx` | `/api/phone` → `phoneController.js` | `021_phone_agent.sql` | Twilio | Live inbound calls unverified | phone suites | Live inbound call |
| Website chatbot | Embeddable lead-qualifying widget | Functional but not fully tested | `sections/ChatbotSetup.jsx`, `public/chatbot-widget.js` | `/api/chatbot` → `websiteChatbotController.js` | `022_chatbot_sessions.sql` | Anthropic | Public widget CORS method-aware | chatbot suites | Embed on test page |
| Sales scripts | AI sales-script generator | Functional but not fully tested (text) | `sections/SalesScripts.jsx`, `sales/*` | `/api/sales-scripts` → `salesScriptController.js` | `023_sales_scripts.sql` | Anthropic | Text-only | — | Manual gen |
| AI Sales Agent | EchoAI's own inbound demo line (admin) | Real but untested | `admin/AdminSalesAgent.jsx` | `/api/sales-agent` → `salesAgentController.js` | `047_sales_agent.sql` | Twilio | Admin-only | sales-agent suites | Live demo call |
| Autonomous conversations | Echo auto-replies to lead messages | Real but untested (outbound send) | (backend-driven) | `/api/autonomous` → `autonomousConversationController.js` | `086_autonomous_conversations.sql` | Hermes, Anthropic, SMS/email | Handoff state incl. 'transferred' (memory `echoai-autonomous-handoff.md`) | autonomous suites | Live lead-reply loop |
| Voter CRM (political) | Supporters/donors/events, political brands only | Functional but not fully tested | `sections/Supporters.jsx` | `/api/supporters` → `supporterController.js` | `076_political_campaign.sql` | none | brand_type='political' gated | supporter suites | Political brand test |
| Property CRM (real estate) | Listings, buyer/seller leads, open houses | Functional but not fully tested | `sections/Properties.jsx` | `/api/properties` → `propertyController.js` | `077_real_estate.sql` | none | brand_type='real_estate' gated | property suites | Real-estate brand test |

## Intelligence (Scout, Sage, Vision)

| Feature | Intended purpose | Status | Frontend file | Backend | DB dependency | Integration | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| Customer Intelligence | Weekly AI strategy profile (Enterprise) | Functional but not fully tested | `sections/CustomerIntelligence.jsx` | `/api/intelligence` → `customerIntelligenceController.js` | `039_customer_intelligence.sql` | Anthropic | Depends on weekly scheduler | intelligence suites | Manual gen |
| Capital & Funding | Grants/funding briefings + drafts (Enterprise) | Functional but not fully tested | `sections/CapitalFunding.jsx` | `/api/capital` → `capitalFundingController.js` | `057_capital_funding.sql` | Anthropic | deadline DATE vs deadline_text (memory) | capital suites | Manual run |
| Competitor Ad Spy | Scans competitors' live FB ads (Enterprise) | Real but untested (FB Ad Library) | `sections/CompetitorAds.jsx` | `/api/competitor-ads` → `competitorAdSpyController.js` | `087_competitor_ad_spy.sql` | Facebook Ad Library | No FB token → empty, nothing fabricated | competitor suites | Live scan w/ token |
| Competitor Sites | Analyze competitor websites for changes | Functional but not fully tested | `sections/CompetitorSites.jsx` | `/api/competitor-sites` → `competitorSiteController.js` | `089/090 competitor_website*.sql` | Anthropic, HTTP fetch (SSRF-guarded) | — | `CompetitorSites.test.jsx` | Manual add competitor |
| Sage (Industry Intelligence) | Company Truth + industry brief + feed | Functional but not fully tested | `sections/Sage.jsx`, `SageOpportunities.jsx` | `/api/sage`, `/api/company-truth` → `sageController.js`, `sagePhase4/5/6Controller.js`, `companyTruthController.js` | `069`, `109`, `111`, `116–122 sage_v2*` | Anthropic web search | Large multi-phase system (V2 phases 1–6); brand isolation critical (memory `echoai-sage-brand-isolation.md`) | `sagePhase4.test.js` + others | Manual per-phase review |
| Vision (Visual Intelligence) | Studies winning visuals; consulted by Forge | Functional but not fully tested | `sections/Vision.jsx` | `/api/vision` → `visionController.js` | `105/106/112 vision*.sql` | Anthropic vision | — | vision suites | Manual study |
| Forge (Creative Director) | Orchestrates creative briefs | Functional but not fully tested | (via adstudio/image) | `utils/forgeDirector.js`, `108/110` | `108_forge_creative_briefs.sql`, `110_hybrid_creative_engine.sql` | Anthropic | Brief history counts item-linked only (memory) | forge suites | Manual creative run |

## Analytics / ROI / reporting

| Feature | Intended purpose | Status | Frontend file | Backend | DB dependency | Integration | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| ROI dashboard | Activity-based ROI estimates | Functional but not fully tested | `sections/RoiDashboard.jsx`, `roi/*` | `/api/roi` → `roiController.js`, `roiDashboardController.js` | `019_roi_snapshots.sql`, `038_roi_advanced.sql` | none | ROI is estimated/modeled, not billed-actuals (`config/roiModel.js`) | `RoiDashboard.*.test.jsx` | Manual review of model assumptions |
| Analytics / weekly reports | Metrics + weekly reporting | Functional but not fully tested | (various) | `/api/analytics` → `analyticsController.js`, `reportingController.js` | `006_weekly_report.sql`, `063_analytics_ctr.sql` | none | Weekly scheduler scope limited by design | analytics suites | Manual report gen |
| Goals & KPI tracking | Target goals + alerts | Functional but not fully tested | `components/Goals*.jsx` | `/api/goals` → `goalController.js` | `060/061/062/064 goal*.sql` | none | No-data snapshots store NULL (memory `echoai-goal-tracking.md`) | `GoalsPanel.*.test.jsx` etc. | Manual goal + alert |
| Economics / AI cost | AI spend tracking + margin (admin) | Functional but not fully tested | `admin/AdminEconomics.jsx` | `economicsAdminController.js`, `utils/aiUsage.js`, `aiBudget.js` | `096_ai_cost_controls.sql`, `104_usage_ledger_extension.sql` | Anthropic/OpenAI usage | See `AI_AND_INFRASTRUCTURE_COST_MAP.md`; backlog enhancements pending | economics suites | Manual review |

## Growth / channel / other

| Feature | Intended purpose | Status | Frontend file | Backend | DB dependency | Integration | Known issue | Test status | Recommended verification |
|---|---|---|---|---|---|---|---|---|---|
| Facebook OAuth | Unified FB connect (ads + posting) | Real but untested (staging) | `components/FacebookConnect.jsx`, `FacebookWizard.jsx` | `/api/facebook` → `facebookOAuthController.js` | `017/054/088 facebook*.sql` | Facebook OAuth | User-scoped by design; staging connect NOT yet tested | facebook suites | Live FB connect on staging |
| Google connect | Google OAuth | Real, verified on staging 2026-07-23 | `components/GoogleConnect.jsx` | `/api/google` → `googleController.js` | `018_google_seo.sql` | Google OAuth | CEO-verified OAuth flow only; downstream API reads still unverified | google suites | Already verified connect; verify reads |
| Jobber CRM sync | Import/push Jobber clients as leads | Real but untested | (via connections) | `/api/jobber` → `jobberController.js` | `124_jobber.sql` | Jobber OAuth | Needs JOBBER_CLIENT_ID/SECRET; advisory lock across remote create (memory `echoai-jobber-sync.md`) | jobber suites | Live Jobber account |
| PWA + web push | Installable PWA + hot-lead push | Real but untested (web-push) | `client/public/sw.js`, `push.js` | `/api/push` → `pushController.js` | `016_push_subscriptions.sql` | web-push (VAPID) | SW cache version must bump (memory `echoai-spa-cache-headers.md`) | push suites | Live push to device |
| Zapier webhooks | SSRF-guarded outbound webhooks (Pro) | Functional but not fully tested | `sections/ZapierIntegration.jsx` | `/api/webhooks` → (webhook routes), `utils/webhookDispatcher.js` | `024_webhooks.sql` | outbound HTTP | SSRF allowlist incl. IPv6-mapped (memory `echoai-ssrf-ipv6-mapped.md`) | webhook suites | Live webhook to test endpoint |
| White label / agencies | Agencies resell under own brand (Enterprise) | Functional but not fully tested | `sections/AgencyPortal.jsx` | `/api/agencies` → `whiteLabelController.js` | `025_white_label.sql` | none | owner_user_id UNIQUE (memory `echoai-white-label.md`) | agency suites | Manual agency setup |
| Affiliate program | Referral commissions (Enterprise) | Functional but not fully tested | `sections/AffiliateProgram.jsx` | `/api/affiliates` → `affiliateController.js` | `026_affiliate_program.sql` | Stripe | Attribution await ordering (memory `echoai-affiliate-attribution.md`) | affiliate suites | Manual referral + payment |
| Mobile API (v2) | Native app backend (Enterprise) | Partially implemented | `EchoAI-Mobile/` (RN scaffold) | `/api/v2` → `mobileController.js`, `mobileAuthController.js`, `mobilePushController.js` | `027_mobile_tokens.sql` | FCM | Mobile app is a scaffold, not shipped | mobile suites | Manual app build |
| Customer feedback | AI surveys + 30-day analysis (Enterprise) | Functional but not fully tested | `sections/Feedback.jsx` | `/api/feedback` → `feedbackController.js` | `030_feedback.sql` | Anthropic | — | `030_feedback` | Manual survey |
| Health monitor & support | Hourly health sweep + AI support | Functional but not fully tested | `sections/SentinelHealth.jsx`, `admin/AdminHealth.jsx` | `/api/health-monitor`, `/api/public/support` → `healthMonitorController.js` | `046_health_monitor.sql` | Anthropic vision (screenshots) | Depends on hourly sweep firing | health suites | Manual sweep + support ticket |
| Feature suggestions | Auto-log unsupported asks via Echo chat | Functional but not fully tested | `admin/AdminFeatureSuggestions.jsx` | `/api/admin/feature-suggestions` → `featureSuggestionAdminController.js` | `083_feature_suggestions.sql` | Anthropic | Confirmation appended only after DB write (memory) | `feature-suggestions` | Manual chat ask |
| Echo Email Assistant | Multi-account IMAP/SMTP inbox triage | Real but untested (IMAP/SMTP) | `sections/EchoEmail.jsx` | `/api/echo-email` → `echoEmailController.js` | `084_email_assistant.sql` | IMAP/SMTP (app passwords) | Approval-gated send; SSRF guard on custom hosts | email-assistant suites | Live inbox connect |
| Echo Personal Assistant | Voice reminders + prioritized tasks | Functional but not fully tested | `sections/EchoPlanner.jsx` | `/api/echo-assistant` → `echoAssistantController.js` | `081_echo_personal.sql`, `082_users_phone.sql` | Twilio (SMS fallback) | Owner SMS reads users.phone (memory) | echo-assistant suites | Manual reminder |
| Echo memory | Searchable memory of what Echo knows | Functional but not fully tested | `sections/EchoMemory.jsx` | `echoMemoryController.js` | `055_echo_deep_memory.sql` | Anthropic | — | memory suites | Manual search |
| Echo voice / conversational core | Always-on voice, TTS/STT, Hermes brain | Partially implemented / flag-gated | `voice/*`, `sections/CoreLab.jsx` | `/api/echo-voice`, `/api/core-lab`, `/api/voice` | `052_echo_voice.sql`, `092_voice_content_sessions.sql` | ElevenLabs, OpenAI, Hermes | Conversational Core is flag-off read-only prototype (memory `echoai-conversational-core.md`); mic blocked in iframe | `voice/*.test.js`, flight recorder | Real browser voice session |
| Music (login) | Background music integration | Functional but not fully tested | `music/MusicContext.jsx`, `components/MusicWidget.jsx` | `/api/music` → `musicController.js` | — | none | — | — | Manual play |
| Geo targeting | Geographic targeting/exclusions | Functional but not fully tested | `components/GeoTargetingCard.jsx` | `/api/geo` → `geoTargetingController.js` | `079_geo_targeting.sql` | FB (applies to ads) | Exclusions are hard blocks; FB fail-closed to state (memory `echoai-geo-targeting.md`) | geo suites | Manual geo config |
| Portfolio | Multi-business unified view | Functional but not fully tested | `sections/Portfolio.jsx` | `/api/portfolio` → `portfolioController.js` | `058_portfolio.sql` | none | Must exclude is_demo brands (memory) | portfolio suites | Multi-brand test |
| Guided tour | Interactive + voice-narrated tour | Functional but not fully tested | `tour/*` | `/api/tour` → `tourController.js` | `040_tour_progress.sql` | TTS | — | `tour/*.test.js` | Manual tour |
| Demo mode | Three-tier read-only demo accounts | Functional but not fully tested | `demo/*`, `admin/AdminDemo.jsx` | `/api/demo` → `demoController.js` | `053_demo_mode.sql`, `054/090/091 demo*` | none | Seeds one is_demo brand per tier (memory `echoai-demo-tiers.md`) | demo suites | Manual demo login |
| Department collaboration bus | Cross-department shared data bus | Partially implemented (dark) | — | `utils/collaborationBus.js`, `directiveBus.js` | `122_collaboration_bus.sql` | none | **Built dark; all COLLAB_* flags OFF** (memory `echoai-dept-collaboration.md`) | collaboration suites | N/A until Stage 1 CEO go-ahead |

---

## Cross-cutting notes

- **"Real but untested" is the honest default** for every external side-effect
  (FB publish/ads, Twilio calls/SMS, Stripe live charges, SMTP/IMAP sends,
  web-push, Google/Jobber API writes, ElevenLabs TTS, OpenAI image gen). Code
  paths exist and target real APIs, but no evidence in the codebase proves the
  external effect occurred in production. See
  `REAL_ACTIONS_VS_SIMULATED_ACTIONS.md` for the per-call-site breakdown.
- **No feature is marked "Fully functional and verified"** at the external-action
  level, because production end-to-end evidence was not available during this
  review. Internal logic is well covered by unit tests (see
  `TESTING_CURRENT_STATE.md`).
- **Two Mission Control implementations** coexist (`MissionControl.jsx` and
  `missioncontrol/MissionControlV2.jsx`) — see
  `KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`.
- **Duplicate-named migrations** exist (e.g. two `067_*`, `068_*`, `071_*`,
  `090_*`, `096_*`) — flagged in technical debt; verify apply order.
