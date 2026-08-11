// agentRegistry — descriptive registry of Zorecho's OPERATING ENTITIES.
//
// GOVERNING INVARIANTS (owner-ruled, verbatim):
//   "The Prompt 025 registry documents and tests the operating model; it does
//   not itself grant runtime authority."
//   "The registry describes operating entities by role; it does not redefine
//   every runtime automation as an agent."
//
// PERMITTED is not the same thing as CURRENTLY USED. An observed execution
// path does NOT become permitted merely because legacy code currently uses
// it; such gaps are recorded honestly in `discrepancies` and are never fixed
// by broadening permittedTools. A registry mismatch causes a test/report
// failure — runtime enforcement gaps remain separate owner-authorized work.
//
// Composition is DERIVED, never copied as constants: named agent identities
// come from controllers/agentsController.js (AGENTS), scheduled automations
// from utils/scheduler.js (scheduleJob registrations), task-type vocabulary
// from models/131/132/133, plus Hermes as its own decision-brain class.

// ---------------------------------------------------------------------------
// Closed vocabularies (validation fails closed on anything outside these).
// ---------------------------------------------------------------------------
const ROLE_CLASSES = Object.freeze([
  "director", // Echo — owner-facing orchestrator
  "specialist_agent", // named marketing-department identity
  "scheduled_automation", // cron-registered background job
  "decision_brain", // Hermes — routing/intent decisions only
]);

const EXECUTION_PATH_CLASSES = Object.freeze([
  "spine_executeExternal", // adopted task-spine flow with external side effects
  "adapter_backed", // legacy adapter recorded post-hoc into the spine
  "feature_only", // feature tables only — cannot support verified-success claims
  "dark", // built but flag-off (no runtime activity)
  "gated_ai", // AI via config/anthropic createMessage + aiGate + ai_usage_log
  "ungated_ai", // I-42: direct provider call sites (description-only in 025)
  "none", // no external side effects / no AI
]);

const STATUSES = Object.freeze(["active", "dark", "historical"]);

// Feature-only marker required verbatim on flows without deterministic proof.
const FEATURE_ONLY_LIMITATION = "cannot support verified-success claims";

// ---------------------------------------------------------------------------
// I-42 reality (description-only in Prompt 025): files with direct provider
// calls that bypass config/anthropic.createMessage + aiGate + ai_usage_log.
// Derived from the current tree; do not "fix" entries to look gated.
// ---------------------------------------------------------------------------
const UNGATED_AI_FILES = Object.freeze([
  "utils/echoPersonal.js",
  "utils/optionalClient.js",
  "controllers/adCreativeStudioController.js",
  "controllers/analyticsController.js",
  "controllers/appointmentController.js",
  "controllers/autonomousConversationController.js",
  "controllers/brandDiscoveryController.js",
  "controllers/chatbotController.js",
  "controllers/competitorAdSpyController.js",
  "controllers/feedbackController.js",
  "controllers/followUpController.js",
  "controllers/optimizationController.js",
  "controllers/phoneController.js",
  "controllers/salesAgentController.js",
  "controllers/smsMarketingController.js",
  "controllers/websiteChatbotController.js",
]);

// ---------------------------------------------------------------------------
// Named agent identities (roster mirrors controllers/agentsController.js —
// the completeness test derives the expected set from that file, both ways).
// ---------------------------------------------------------------------------
const AGENT_ENTRIES = [
  {
    id: "echo",
    displayName: "Echo",
    roleClasses: ["director"],
    status: "active",
    permittedTools: ["gated_ai", "voice_synthesis", "navigation", "notifications"],
    prohibitedActions: [
      "external publishes/sends without an enforcement boundary's approval",
      "narrating outcomes beyond utils/honestStatus discipline",
      "authoritative brand-profile writes (proposer only, via brandKnowledge)",
    ],
    observedExecutionPaths: ["gated_ai", "ungated_ai", "feature_only"],
    triggers: ["owner login", "owner voice/text", "proactive queue delivery"],
    inputs: ["owner utterances", "honestStatus reads", "briefing data"],
    outputs: ["voice/text narration", "navigation", "held proactive items"],
    workQueue: null,
    escalation: "surfaces to owner; never self-authorizes external actions",
    approvalRequirements: "owner approval for any external side effect",
    proofRequirements: "verified-success claims only via honestStatus lineage",
    successCriteria: "owner-facing narration matches authoritative evidence",
    adapterBacked: null,
    knowledgeAuthority: "proposer (brandKnowledge boundary); reads approved versions only",
    discrepancies: [
      "utils/echoPersonal.js contains I-42 ungated direct-provider calls (description-only)",
    ],
  },
  {
    id: "scout",
    displayName: "Scout",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "web_research"],
    prohibitedActions: ["external publishes/sends", "authoritative brand-profile writes"],
    observedExecutionPaths: ["gated_ai", "feature_only"],
    triggers: ["scheduled competitor/funding scans", "owner requests"],
    inputs: ["competitor data", "funding sources"],
    outputs: ["intelligence findings", "funding pipeline rows"],
    workQueue: null,
    escalation: "findings surface in feeds; owner acts",
    approvalRequirements: "none (read-only research)",
    proofRequirements: `feature-only outputs ${FEATURE_ONLY_LIMITATION}`,
    successCriteria: "findings recorded with provenance",
    adapterBacked: null,
    knowledgeAuthority: "proposer via brandKnowledge boundary",
    discrepancies: [],
  },
  {
    id: "atlas",
    displayName: "Atlas",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "facebook_ads_via_spine"],
    prohibitedActions: [
      "campaign go-live without owner approval + spend-cap guardrails",
      "writing campaigns.status directly (live only via verified read-back)",
    ],
    observedExecutionPaths: ["spine_executeExternal", "gated_ai"],
    triggers: ["weekly-autopilot", "owner-approved launches"],
    inputs: ["approved growth actions", "ad creatives", "brand ad destination"],
    outputs: ["ad_launch tasks", "campaigns (created_paused until verified live)"],
    workQueue: "agent_tasks task_type='ad_launch'",
    escalation: "MANUAL_REVIEW on uncertain outcomes",
    approvalRequirements: "owner approval; deny-by-default spend caps",
    proofRequirements: "ad_launch spine lifecycle + external_proofs",
    successCriteria: "verified campaign lifecycle truth",
    adapterBacked: null,
    knowledgeAuthority: null,
    discrepancies: [],
  },
  {
    id: "nova",
    displayName: "Nova",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "social_publish_via_spine"],
    prohibitedActions: ["publishing without scheduled/approved post rows"],
    observedExecutionPaths: ["spine_executeExternal", "gated_ai"],
    triggers: ["social-publish tick", "content calendar generation"],
    inputs: ["scheduled social_posts", "brand content settings"],
    outputs: ["social_publish tasks", "published posts with read-back proofs"],
    workQueue: "agent_tasks task_type='social_publish'",
    escalation: "failed→scheduled reschedule is owner-driven; rescue sweep marks interrupted publishes",
    approvalRequirements: "owner-approved calendars/posts",
    proofRequirements: "publish read-back proof via task lineage",
    successCriteria: "verified publish outcomes",
    adapterBacked: null,
    knowledgeAuthority: null,
    discrepancies: [
      "social_publish lineage does not record Nova as actor — Echo reports the verified event without invented agent credit (B5)",
    ],
  },
  {
    id: "pulse",
    displayName: "Pulse",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "email_send_via_spine", "sms_send"],
    prohibitedActions: ["sending outside approval-gated claims"],
    observedExecutionPaths: ["spine_executeExternal", "gated_ai", "ungated_ai", "feature_only"],
    triggers: ["follow-up-touchpoints", "drip-emails", "email-blasts", "lead events"],
    inputs: ["leads", "sequences", "campaigns"],
    outputs: ["email_send tasks", "sms_messages", "touchpoints"],
    workQueue: "agent_tasks task_type='email_send'",
    escalation: "accepted-then-persist-fail = MANUAL_REVIEW, never resend",
    approvalRequirements: "approval-gated sends where configured",
    proofRequirements: "Message-ID gate for spine email sends",
    successCriteria: "verified sends; honest failure classification",
    adapterBacked: "email adapter (D-29.7 ratchet; retirement prompt per adapter inventory)",
    knowledgeAuthority: null,
    discrepancies: [
      "followUpController.js / smsMarketingController.js are on the I-42 ungated list (description-only)",
    ],
  },
  {
    id: "voice",
    displayName: "Voice",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "twilio_calls", "website_chatbot"],
    prohibitedActions: ["outbound actions beyond configured phone/chat scope"],
    observedExecutionPaths: ["ungated_ai", "feature_only"],
    triggers: ["inbound calls/chats"],
    inputs: ["call/chat transcripts"],
    outputs: ["calls rows", "chat responses", "lead captures"],
    workQueue: null,
    escalation: "handoff to owner (autonomous handoff CAS)",
    approvalRequirements: "none at runtime (inbound reactive)",
    proofRequirements: `feature-only activity ${FEATURE_ONLY_LIMITATION}`,
    successCriteria: "handled conversations recorded",
    adapterBacked: null,
    knowledgeAuthority: null,
    discrepancies: [
      "phoneController.js / websiteChatbotController.js / chatbotController.js on I-42 ungated list (description-only)",
    ],
  },
  {
    id: "forge",
    displayName: "Forge",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "image_generation"],
    prohibitedActions: ["publishing creatives (hands off to Nova/Atlas flows)"],
    observedExecutionPaths: ["gated_ai", "ungated_ai", "feature_only"],
    triggers: ["creative briefs", "weekly content generation"],
    inputs: ["briefs", "brand assets", "Vision consults"],
    outputs: ["ad_creatives", "generated_images/videos"],
    workQueue: null,
    escalation: "owner review of creatives",
    approvalRequirements: "owner approves before use in live flows",
    proofRequirements: `creative records ${FEATURE_ONLY_LIMITATION}`,
    successCriteria: "creatives generated and linked to briefs",
    adapterBacked: null,
    knowledgeAuthority: null,
    discrepancies: [
      "adCreativeStudioController.js on I-42 ungated list (description-only)",
    ],
  },
  {
    id: "sentinel",
    displayName: "Sentinel",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["health_checks", "auto_fixes_within_app"],
    prohibitedActions: ["external provider mutations"],
    observedExecutionPaths: ["feature_only", "none"],
    triggers: ["health-monitor-sweep", "data-quality-sentry"],
    inputs: ["system/brand health signals"],
    outputs: ["health_checks rows", "auto-fix records"],
    workQueue: null,
    escalation: "critical issues surface to owner",
    approvalRequirements: "none (internal only)",
    proofRequirements: `health records ${FEATURE_ONLY_LIMITATION}`,
    successCriteria: "issues found/fixed recorded honestly",
    adapterBacked: null,
    knowledgeAuthority: null,
    discrepancies: [],
  },
  {
    id: "sage",
    displayName: "Sage",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "industry_research"],
    prohibitedActions: ["authoritative brand-profile writes", "hard-deleting dismissed feed items"],
    observedExecutionPaths: ["gated_ai", "feature_only"],
    triggers: ["sage-* scheduled studies", "owner questions"],
    inputs: ["industry data", "competitor patterns", "brand context"],
    outputs: ["sage findings/opportunities (provenance-recorded)"],
    workQueue: null,
    escalation: "urgent signals surface in feed",
    approvalRequirements: "Company Truth requires owner approval before Layer-2 reads",
    proofRequirements: `research outputs ${FEATURE_ONLY_LIMITATION}`,
    successCriteria: "findings with provenance; no fabricated data",
    adapterBacked: null,
    knowledgeAuthority: "proposer via brandKnowledge boundary; approved/versioned knowledge distinct from drafts",
    discrepancies: [
      "computeAgents previously hard-coded status 'active' — replaced with recorded recency (Section F)",
    ],
  },
  {
    id: "vision",
    displayName: "Vision",
    roleClasses: ["specialist_agent"],
    status: "active",
    permittedTools: ["gated_ai", "visual_study"],
    prohibitedActions: ["external publishes"],
    observedExecutionPaths: ["gated_ai", "feature_only"],
    triggers: ["vision-daily-study"],
    inputs: ["industry visual data"],
    outputs: ["vision_study_runs", "visual knowledge versions"],
    workQueue: null,
    escalation: "none (consultative)",
    approvalRequirements: "none",
    proofRequirements: `study records ${FEATURE_ONLY_LIMITATION}`,
    successCriteria: "completed studies recorded",
    adapterBacked: null,
    knowledgeAuthority: null,
    discrepancies: [
      "computeAgents previously hard-coded status 'active' — replaced with recorded recency (Section F)",
    ],
  },
];

// ---------------------------------------------------------------------------
// Hermes — its own operating-entity class (D-9: untouched, descriptive only).
// ---------------------------------------------------------------------------
const HERMES_ENTRY = {
  id: "hermes",
  displayName: "Hermes",
  roleClasses: ["decision_brain"],
  status: "active",
  permittedTools: ["gated_ai_decision_calls"],
  prohibitedActions: [
    "writing owner-facing content (Claude writes; Hermes decides)",
    "external side effects of any kind",
  ],
  observedExecutionPaths: ["gated_ai"],
  triggers: ["voice/chat turns requiring intent/routing/on-topic/brand-lock decisions"],
  inputs: ["utterances + conversation context"],
  outputs: ["decision objects (hermes_decisions telemetry)"],
  workQueue: null,
  escalation: "decide()→null on any failure — callers proceed without a decision",
  approvalRequirements: "none (advisory only)",
  proofRequirements: "decisions are telemetry, never outcome claims",
  successCriteria: "in-budget decisions (~6s single attempt), honest nulls",
  adapterBacked: null,
  knowledgeAuthority: null,
  discrepancies: [],
};

// ---------------------------------------------------------------------------
// Scheduled automations — entries derived from utils/scheduler.js job list.
// Every job MUST have metadata here; a job without metadata (or metadata
// without a job) fails validation. Classification is honest per job.
// ---------------------------------------------------------------------------
const JOB_META = Object.freeze({
  "api-quota-sweep": { paths: ["none"], note: "internal quota monitor" },
  "autonomous-growth": { paths: ["gated_ai", "spine_executeExternal"], note: "guardrailed daily engine; approve/decline atomics" },
  "autonomous-growth-summary": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "autonomous-timeout-sweep": { paths: ["none"], note: "conversation timeout sweep" },
  "beta-program-sweep": { paths: ["none"], note: "beta slot maintenance" },
  "closing-summaries": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "competitor-ad-scan": { paths: ["ungated_ai", "feature_only"], note: `I-42 site; ${FEATURE_ONLY_LIMITATION}` },
  "competitor-scan": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "competitor-site-digest": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "competitor-site-monitor": { paths: ["feature_only"], note: FEATURE_ONLY_LIMITATION },
  "cross-business-intelligence": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "daily-task-sweep": { paths: ["none"], note: "task hygiene" },
  "data-quality-sentry": { paths: ["none"], note: "data quality checks" },
  "drip-emails": { paths: ["adapter_backed"], note: "email adapter — D-29.7 ratchet; retirement per adapter inventory" },
  "email-blasts": { paths: ["adapter_backed"], note: "email adapter — D-29.7 ratchet; retirement per adapter inventory" },
  "email-inbox-sweep": { paths: ["gated_ai", "feature_only"], note: "cursor-first sweep; approval-gated sends via spine" },
  "external-actions-reconcile": { paths: ["spine_executeExternal"], note: "reconciliation task type" },
  "follow-up-touchpoints": { paths: ["adapter_backed", "ungated_ai"], note: "I-42 site; adapter — D-29.7 ratchet" },
  "goal-tracking": { paths: ["feature_only"], note: "NULL not 0 no-data snapshots" },
  "health-monitor-sweep": { paths: ["feature_only"], note: FEATURE_ONLY_LIMITATION },
  "morning-briefing-warm": { paths: ["gated_ai", "feature_only"], note: "briefing cache warm" },
  "objections-mining": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "personal-reminders": { paths: ["feature_only"], note: "owner SMS reminders" },
  "portfolio-health-snapshots": { paths: ["feature_only"], note: "excludes demo brands" },
  "re-content-evening": { paths: ["gated_ai", "feature_only"], note: "real-estate vertical content" },
  "re-content-midday": { paths: ["gated_ai", "feature_only"], note: "real-estate vertical content" },
  "re-content-morning": { paths: ["gated_ai", "feature_only"], note: "real-estate vertical content" },
  "re-listing-promotion": { paths: ["gated_ai", "feature_only"], note: "real-estate vertical" },
  "re-open-house": { paths: ["gated_ai", "feature_only"], note: "real-estate vertical" },
  "re-seller-lead-ads": { paths: ["gated_ai", "feature_only"], note: "real-estate vertical" },
  "sage-deep-research": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "sage-opportunity-maintenance": { paths: ["none"], note: "opportunity lifecycle upkeep" },
  "sage-opportunity-synthesis": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "sage-pattern-study": { paths: ["gated_ai", "feature_only"], note: "prevalence not engagement" },
  "sage-urgent-scan": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "social-connection-reverify": { paths: ["none"], note: "hard-auth-failure flips only" },
  "social-publish": { paths: ["spine_executeExternal"], note: "adopted spine flow" },
  "task-spine-reconcile": { paths: ["spine_executeExternal"], note: "stale-claim rescue" },
  "vision-daily-study": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "voice-reminders": { paths: ["feature_only"], note: "voice queue items" },
  "weekly-analytics": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "weekly-autopilot": { paths: ["spine_executeExternal", "gated_ai"], note: "ad_launch spine adopter" },
  "weekly-learning-study": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
  "weekly-self-review": { paths: ["gated_ai", "feature_only"], note: FEATURE_ONLY_LIMITATION },
});

/**
 * Build scheduled-automation entries from the scheduler's own registrations.
 * @param {Array<{name: string, ai: boolean}>} jobs utils/scheduler listScheduledJobs()
 *   (or an equivalently derived name list in tests).
 */
function buildAutomationEntries(jobs) {
  return jobs.map((job) => {
    const meta = JOB_META[job.name];
    if (!meta) {
      // Fail closed: an undocumented runtime entity is a validation failure.
      throw new Error(`agentRegistry: scheduled job "${job.name}" has no registry metadata`);
    }
    return {
      id: `job:${job.name}`,
      displayName: job.name,
      roleClasses: ["scheduled_automation"],
      status: "active",
      permittedTools: meta.paths.includes("spine_executeExternal")
        ? ["task_spine_execution"]
        : meta.paths.includes("adapter_backed")
          ? ["adapter_send"]
          : [],
      prohibitedActions: ["anything beyond its registered run function"],
      observedExecutionPaths: meta.paths,
      triggers: ["cron"],
      inputs: ["scheduled tick"],
      outputs: ["job_runs row (claim + outcome)"],
      workQueue: null,
      escalation: "job_runs outcome 'failed' with reason",
      approvalRequirements: "AI-consuming jobs obey aiGate/controls",
      proofRequirements: meta.paths.includes("spine_executeExternal")
        ? "spine lifecycle + proofs"
        : FEATURE_ONLY_LIMITATION,
      successCriteria: "claimed tick recorded success/skipped/failed honestly",
      adapterBacked: meta.paths.includes("adapter_backed") ? meta.note : null,
      knowledgeAuthority: null,
      discrepancies: meta.paths.includes("ungated_ai") ? ["I-42 ungated AI call site (description-only)"] : [],
      note: meta.note,
    };
  });
}

/** Full registry: named agents + Hermes + derived scheduled automations. */
function buildRegistry(jobs) {
  return [...AGENT_ENTRIES, HERMES_ENTRY, ...buildAutomationEntries(jobs)];
}

/** Composition by role class — documentation reports THIS, never "N agents". */
function compositionByRoleClass(registry) {
  const out = {};
  for (const e of registry) {
    for (const rc of e.roleClasses) out[rc] = (out[rc] || 0) + 1;
  }
  return out;
}

module.exports = {
  ROLE_CLASSES,
  EXECUTION_PATH_CLASSES,
  STATUSES,
  FEATURE_ONLY_LIMITATION,
  UNGATED_AI_FILES,
  AGENT_ENTRIES,
  HERMES_ENTRY,
  JOB_META,
  buildAutomationEntries,
  buildRegistry,
  compositionByRoleClass,
};
