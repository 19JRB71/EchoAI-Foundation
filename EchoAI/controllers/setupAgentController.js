const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const { SETUP_AGENT_SYSTEM_PROMPT } = require("../prompts/setupAgentPrompt");
const gapEngine = require("../utils/interviewGapEngine");
const knowledge = require("../utils/brandKnowledge");
const { getUserTier } = require("../middleware/featureGate");
const { FEATURES, meetsTier } = require("../config/tiers");
const { geoSummaryText } = require("../utils/geoTargeting");
const {
  normalizeWebsiteUrl,
  normalizeFacebookPageUrl,
  isRefusalAnswer,
  extractUrlCandidates,
} = require("../utils/onlinePresence");

const brandDiscoveryController = require("../controllers/brandDiscoveryController");
const campaignController = require("../controllers/campaignController");
const appointmentController = require("../controllers/appointmentController");
const contentCalendarController = require("../controllers/contentCalendarController");
const adCreativeStudioController = require("../controllers/adCreativeStudioController");
const emailMarketingController = require("../controllers/emailMarketingController");
const feedbackController = require("../controllers/feedbackController");
const { generateKeywordSuggestions } = require("../prompts/seoContentPrompt");
const voiceController = require("../controllers/voiceController");
const echoContext = require("../utils/echoContext");
const { parseBusinessHours } = require("../utils/hoursParser");
const anchorOrchestrator = require("../utils/anchorOrchestrator");

// ---------------------------------------------------------------------------
// AI helpers (real Anthropic; malformed output → 502, never guessed)
// ---------------------------------------------------------------------------

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

function upstreamError(message) {
  const err = new Error(message);
  err.statusCode = 502;
  return err;
}

/**
 * Given the interview transcript so far, ask the AI for the next question (or a
 * completion signal). Returns a validated { message, suggestion, collects,
 * complete } object.
 */
async function askInterview(messages, { userId = null, brandId = null } = {}) {
  let response;
  try {
    // Prompt 023 (D-36 F): the interview call runs through the governed
    // config/anthropic.createMessage chokepoint — aiGate admission (emergency
    // switches, environment policy, rate limits, budgets) + ai_usage_log
    // accounting under feature 'setup_interview'. Never the raw SDK.
    response = await module.exports._createMessage(
      {
        model: MODEL,
        max_tokens: 1024,
        system: SETUP_AGENT_SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      },
      {
        label: "Setup interview",
        feature: "setup_interview",
        userId,
        brandId,
        attempts: 1,
      },
    );
  } catch (err) {
    // An aiGate admission block is an honest, deliberate 503 with its own
    // owner-readable message — surface it as-is, never masked as a 502.
    if (err && err.aiBlocked) {
      const blocked = new Error(err.message);
      blocked.statusCode = err.statusCode || 503;
      throw blocked;
    }
    // Log the REAL upstream failure (status + message) so operators can
    // diagnose from server logs; the user still gets the generic 502 below.
    console.error(
      `Setup interview AI call failed${err && err.status ? ` (status ${err.status})` : ""}: ${
        (err && err.message) || err
      }`,
    );
    throw upstreamError(
      "The AI provider could not continue the setup interview right now. Please try again shortly.",
    );
  }

  const text = extractText(response);
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw upstreamError("The setup agent returned an unreadable response. Please try again.");
  }

  if (
    !parsed ||
    typeof parsed.message !== "string" ||
    parsed.message.trim() === "" ||
    typeof parsed.complete !== "boolean"
  ) {
    throw upstreamError("The setup agent returned an incomplete response. Please try again.");
  }

  return {
    message: parsed.message.trim(),
    suggestion: typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : "",
    collects: typeof parsed.collects === "string" ? parsed.collects.trim() : "",
    complete: parsed.complete === true,
  };
}

// ---------------------------------------------------------------------------
// In-process controller invocation (synthetic req/res), mirroring
// voiceController.invokeChatbot so the exact same pipelines are reused.
// ---------------------------------------------------------------------------

function invoke(controllerFn, userId, { body = {}, params = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { body, params, user: { userId } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
      send(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
    };
    Promise.resolve(controllerFn(req, res)).catch(reject);
  });
}

/** Throws (propagating status) when an invoked controller returned an error. */
function ensureOk(result, fallbackMessage) {
  if (result.statusCode >= 200 && result.statusCode < 300) return result.payload;
  const err = new Error((result.payload && result.payload.error) || fallbackMessage);
  err.statusCode = result.statusCode;
  // 026-C3-PM5 §6: the invoke() boundary strips error-object markers, so a
  // terminal provider classification made inside the invoked controller
  // (campaignController failureClass) rides the JSON body and is re-attached
  // here — classifyStepError stays marker-first and the failure can never be
  // misfiled as an AI outage.
  if (result.payload && result.payload.failureClass === "provider_permission") {
    err.providerPermission = true;
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Answer interpretation helpers (resilient to whatever keys the AI chose)
// ---------------------------------------------------------------------------

function answersBlob(answers) {
  return Object.values(answers || {})
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(" \n ")
    .toLowerCase();
}

function firstAnswer(answers, keySubstrings) {
  for (const [k, v] of Object.entries(answers || {})) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (keySubstrings.some((s) => k.toLowerCase().includes(s))) return v.trim();
  }
  return "";
}

// PURE — extract the onboarding personalization answers (working style) from
// the interview answers. Unrecognized answers are omitted — never guessed.
function extractWorkingStyle(answers) {
  const style = {};

  const involvement = echoContext.normalizeInvolvement(
    firstAnswer(answers, ["echo_involvement", "involvement", "involved"]),
  );
  if (involvement) style.involvement = involvement;

  const briefing = (firstAnswer(answers, ["echo_daily_briefing", "daily_briefing"]) || "").toLowerCase();
  if (/\b(yes|yeah|yep|sure|please|absolutely|definitely|of course|ok)\b/.test(briefing)) {
    style.daily_briefing = true;
  } else if (/\b(no|nope|nah|skip|don'?t)\b/.test(briefing)) {
    style.daily_briefing = false;
  }

  const alerts = (firstAnswer(answers, ["echo_instant_alerts", "instant_alert", "alert"]) || "").toLowerCase();
  if (/right away|immediat|instant|as (it|they) happen|yes|alert me/.test(alerts)) {
    style.instant_alerts = true;
  } else if (/briefing|save|wait|later|no\b/.test(alerts)) {
    style.instant_alerts = false;
  }

  const detail = (firstAnswer(answers, ["echo_detail_level", "detail_level", "detail"]) || "").toLowerCase();
  if (/short|brief|concise|to the point|quick|summary/.test(detail)) {
    style.detail_level = "concise";
  } else if (/full|detail|everything|thorough|complete|in.?depth/.test(detail)) {
    style.detail_level = "detailed";
  }

  return style;
}

function pickPlatforms(answers) {
  const blob = answersBlob(answers);
  const supported = ["facebook", "instagram", "tiktok", "linkedin", "twitter", "youtube"];
  const found = supported.filter((p) => blob.includes(p));
  return found.length > 0 ? found : ["facebook", "instagram"];
}

function pickFrequency(answers) {
  const blob = answersBlob(answers);
  if (blob.includes("daily") || blob.includes("every day")) return "daily";
  if (blob.includes("five") || blob.includes("5 ") || blob.includes("5x")) return "five_per_week";
  return "three_per_week";
}

function pickCampaignGoal(answers) {
  const blob = answersBlob(answers);
  if (blob.includes("sale") || blob.includes("revenue")) return "sales";
  if (blob.includes("aware")) return "brand_awareness";
  if (blob.includes("traffic") || blob.includes("visit")) return "traffic";
  if (blob.includes("engage")) return "engagement";
  return "lead_generation";
}

// Extract the MONTHLY advertising-budget ceiling (dollars) the user named, so
// campaigns can be sized to never exceed it. Ranges like "$200–$500/month"
// resolve to the TOP of the range (500) — that is the most they said they'd
// spend, and we still stay under it once divided down to a daily figure. A
// per-day figure ("$30/day") is scaled up to a ~30-day monthly ceiling. Returns
// null when nothing usable was collected.
function pickMonthlyAdBudget(answers) {
  const raw = firstAnswer(answers, ["budget", "spend", "advertising"]);
  if (!raw) return null;
  const nums = (raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  const perDay = /\bdaily\b|\bday\b|\/\s*day|per\s*day/i.test(raw);
  const ceiling = Math.max(...nums);
  return perDay ? ceiling * 30 : ceiling;
}

// Derive a sensible DAILY ad budget (dollars) for the first campaign that, over
// a ~30-day month, never exceeds the monthly ceiling the user specified. Falls
// back to a conservative $20/day when nothing usable was collected.
function pickAdBudget(answers) {
  const monthly = pickMonthlyAdBudget(answers);
  if (!monthly) return 20;
  return Math.max(1, Math.floor(monthly / 30));
}

// Whether the user opted in to Google ads during the interview. Only an explicit
// affirmative counts; a negative or missing answer leaves Google setup skipped.
function wantsGoogleAds(answers) {
  const text = (firstAnswer(answers, ["google_ads", "google"]) || "").toLowerCase();
  if (!text) return false;
  if (/\b(no|nope|nah|not now|not right now|maybe later|later|don'?t|do not|skip)\b/.test(text)) {
    return false;
  }
  return /\b(yes|yeah|yep|sure|please|ok|okay|absolutely|definitely|sounds good|let'?s|go for it|i'?m in|interested)\b/.test(
    text,
  );
}

// Build a keyword-research topic for the Google Ads plan from the interview
// answers: what they offer, and where (so keywords reflect their real market).
function googleAdsTopic(answers) {
  const product =
    firstAnswer(answers, ["product", "offering", "focus", "service"]) ||
    firstAnswer(answers, ["business"]) ||
    "our products and services";
  const location = firstAnswer(answers, [
    "location",
    "service_area",
    "area",
    "city",
    "region",
    "state",
    "market",
  ]);
  return location ? `${product} in ${location}` : product;
}

// --- Real-estate detection ---------------------------------------------------
// Same two-signal approach as political detection: the "account_type" answer,
// with real-estate-specific collect keys as a backstop.
function isRealEstateSetup(answers) {
  const acct = (firstAnswer(answers, ["account_type"]) || "").toLowerCase();
  if (/(real ?estate|realtor|realty|broker|listing agent|buyer'?s agent)/.test(acct)) return true;
  return !!(
    firstAnswer(answers, ["brokerage"]) ||
    firstAnswer(answers, ["markets_served", "geographic_markets"]) ||
    firstAnswer(answers, ["client_focus", "buyer_seller_focus"])
  );
}

// Map interview answers → the brands.real_estate_profile JSONB shape used by
// utils/realEstateContext. Only real answers are stored — nothing invented.
function realEstateProfileFromAnswers(answers) {
  const profile = {
    agent_name: firstAnswer(answers, ["agent_name", "team_name"]),
    brokerage: firstAnswer(answers, ["brokerage"]),
    markets_served: firstAnswer(answers, ["markets_served", "geographic_markets", "service_area"]),
    client_focus: firstAnswer(answers, ["client_focus", "buyer_seller_focus"]),
    price_range: firstAnswer(answers, ["price_range", "average_price"]),
    target_clients: firstAnswer(answers, ["target_clients", "client_demographics"]),
    active_listings_note: firstAnswer(answers, ["active_listings", "current_listings"]),
  };
  for (const key of Object.keys(profile)) {
    if (!profile[key]) delete profile[key];
  }
  return profile;
}

// Persist the business's own website and Facebook page from the interview
// answers. AI-capture semantics (non-empty merge): only real, normalizable
// answers are written; "no"/"none"/unusable answers never blank anything.
async function applyOnlinePresence(userId, brandId, answers) {
  const sets = [];
  const values = [];
  let idx = 1;

  const rawSite = firstAnswer(answers, ["business_website", "website", "web_address", "site"]);
  if (rawSite && !isRefusalAnswer(rawSite)) {
    const norm = normalizeWebsiteUrl(rawSite);
    if (norm.ok && norm.value) {
      sets.push(`website_url = $${idx++}`);
      values.push(norm.value);
    }
  }
  const rawPage = firstAnswer(answers, ["facebook_page", "facebook"]);
  if (rawPage && !isRefusalAnswer(rawPage)) {
    const norm = normalizeFacebookPageUrl(rawPage);
    if (norm.ok && norm.value) {
      sets.push(`facebook_page_url = $${idx++}`);
      values.push(norm.value);
    }
  }
  if (sets.length === 0) return false;
  values.push(brandId, userId);
  await db.query(
    `UPDATE brands SET ${sets.join(", ")}, updated_at = NOW()
      WHERE brand_id = $${idx++} AND user_id = $${idx}`,
    values,
  );
  return true;
}

// ---------------------------------------------------------------------------
// Prompt 035 Section C — owner-fact handoff into the Prompt-011 knowledge
// substrate. VERBATIM-ONLY rule (C1): only the owner's raw interview answer
// text may enter the instant owner-stated path. Any AI paraphrase, synthesis,
// or interpretation must go through the pending proposal/revision machinery
// instead — this function therefore reads ONLY `answers` (raw owner input,
// stored key→verbatim-string) and never AI-derived values.
// ---------------------------------------------------------------------------

/** Interview answer aliases → Prompt-011 knowledge field keys (verbatim). */
const STATED_FACT_MAP = [
  { fieldKey: "phone", aliases: ["business_phone", "phone_number", "phone", "contact_number"] },
  { fieldKey: "address", aliases: ["business_address", "street_address", "address"] },
  { fieldKey: "hours", aliases: ["business_hours", "opening_hours", "hours"] },
  { fieldKey: "email", aliases: ["business_email", "contact_email"] },
];

/**
 * Write explicit interview answers through the existing ownerEditFields path
 * (source=stated, field-level approved — Prompt 011 semantics for owner
 * input). Idempotent: a field whose current approved value already equals the
 * verbatim answer is skipped, so action-runner re-runs never spam versions.
 * Refusals ("no", "none", "skip") are never written. Returns the list of
 * field keys written. Failures are surfaced to the caller (the action runner
 * already records failed steps honestly) — never swallowed silently.
 */
async function applyStatedFacts(userId, brandId, answers) {
  const current = await knowledge.getApprovedKnowledge(brandId);
  const fields = [];
  for (const { fieldKey, aliases } of STATED_FACT_MAP) {
    const raw = firstAnswer(answers, aliases);
    if (!raw || isRefusalAnswer(raw)) continue;
    if (raw.length > 8000) continue; // substrate size guard; oversize stays in answers
    const existing = current && current[fieldKey] ? current[fieldKey].value : null;
    if (existing === raw) continue; // already current — no duplicate version
    fields.push({ fieldKey, value: raw });
  }
  if (fields.length === 0) return [];
  await knowledge.ownerEditFields({
    brandId,
    userId,
    fields,
    proposedBy: "setup_interview",
  });
  return fields.map((f) => f.fieldKey);
}

/**
 * P035-C1 — conversational-path early brand creation.
 *
 * Called at the business-name confirmation boundary: the FIRST interview turn
 * where the gap engine targeted `business_name` and the owner's answer
 * resolved it (state.resolved.business_name), while the session has no brand.
 * That is the narrowest existing owner-confirmed identity point in the flow —
 * the engine only marks business_name resolved on an owner-stated or
 * owner-confirmed value, never on arbitrary partial text.
 *
 * Reuses the EXISTING creation write (the same enumerated brands-INSERT +
 * ownerEditFields(business_name) pair the discovery saveProfile path uses) —
 * no new substrate, no new schema, no second engine. The end-of-interview
 * create_brand_profile action then seeds its discovery session WITH this
 * brand id, so the accepted synthesis pipeline UPDATES this same brand.
 *
 * Best-effort: on any failure the interview continues unharmed and the brand
 * is created at execution time exactly as before (honest fallback, logged).
 * The setup_sessions bind is guarded (`brand_id IS NULL`) so a concurrent
 * writer can never leave a second, orphaned brand bound nowhere — if the
 * guard loses, the transaction rolls back and no brand row survives.
 */
async function ensureInterviewBrand(userId, session, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.length > 200) return null;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id`,
      [userId, trimmed],
    );
    const brandId = inserted.rows[0].brand_id;
    await knowledge.ownerEditFields({
      brandId,
      userId,
      fields: [{ fieldKey: "business_name", value: trimmed }],
      proposedBy: "setup_interview",
      refId: session.session_id,
      client,
    });
    const bound = await client.query(
      `UPDATE setup_sessions SET brand_id = $1, updated_at = NOW()
        WHERE session_id = $2 AND brand_id IS NULL
        RETURNING session_id`,
      [brandId, session.session_id],
    );
    if (bound.rows.length === 0) {
      // Raced: something else bound a brand first. Roll back so no orphan
      // brand row exists; the already-bound brand wins.
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    session.brand_id = brandId;
    return brandId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("P035-C1 early brand creation failed (interview continues):", err.message);
    return null;
  } finally {
    client.release();
  }
}

// When the interview identified a real-estate agent, mark the brand as the
// 'real_estate' brand type and persist the profile. Idempotent — re-runs
// simply rewrite the same values. Returns true when the brand was marked.
async function applyRealEstateProfile(userId, brandId, answers) {
  if (!isRealEstateSetup(answers)) return false;
  const profile = realEstateProfileFromAnswers(answers);
  await db.query(
    `UPDATE brands
        SET brand_type = 'real_estate',
            real_estate_profile = $1::jsonb,
            updated_at = NOW()
      WHERE brand_id = $2 AND user_id = $3`,
    [JSON.stringify(profile), brandId, userId],
  );
  return true;
}

// --- Political-campaign detection -----------------------------------------
// The interview's first question collects "account_type"; campaign-specific
// collects keys (candidate_name, office_sought, ...) are a second signal so a
// mislabelled first answer still resolves correctly.
function isPoliticalSetup(answers) {
  const acct = (firstAnswer(answers, ["account_type"]) || "").toLowerCase();
  if (/(politic|campaign|candidate|running for|election|office)/.test(acct)) return true;
  return !!(
    firstAnswer(answers, ["candidate_name", "candidate"]) ||
    firstAnswer(answers, ["office_sought", "office"])
  );
}

// Map interview answers → the brands.campaign_profile JSONB shape used by
// utils/politicalContext. Only real answers are stored — nothing invented.
function campaignProfileFromAnswers(answers) {
  const profile = {
    candidate_name: firstAnswer(answers, ["candidate_name", "candidate"]),
    office_sought: firstAnswer(answers, ["office_sought", "office"]),
    district: firstAnswer(answers, ["district", "area", "geograph"]),
    key_issues: firstAnswer(answers, ["key_issues", "issues", "platform_positions"]),
    voter_demographics: firstAnswer(answers, ["voter_demographics", "demograph", "target_voter"]),
    opponent_name: firstAnswer(answers, ["opponent"]),
    website_socials: firstAnswer(answers, ["campaign_website_socials", "website", "social_media_pages"]),
    paid_for_by: firstAnswer(answers, ["paid_for_by", "committee"]),
  };
  for (const key of Object.keys(profile)) {
    if (!profile[key]) delete profile[key];
  }
  return profile;
}

function compiledBusinessSummary(answers) {
  const lines = Object.entries(answers || {})
    .filter(([, v]) => (typeof v === "string" ? v.trim() : v != null))
    .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return [
    "Here is everything I want you to know about my business, gathered from a setup interview. Use it to build my brand profile:",
    ...lines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Setup action runner. Each action is atomic + idempotent (completed steps are
// recorded so re-runs skip finished work) and tier-gated (gated actions are
// skipped gracefully for lower tiers).
// ---------------------------------------------------------------------------

const DEFAULT_WEEKLY_HOURS = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: "09:00",
  end: "17:00",
}));

// When the interview identified a political campaign, mark the brand as the
// 'political' brand type and persist the campaign profile (candidate, office,
// district, issues, opponent, disclosure name...). Idempotent — re-runs simply
// rewrite the same values. Returns true when the brand was marked political.
async function applyPoliticalProfile(userId, brandId, answers) {
  if (!isPoliticalSetup(answers)) return false;
  const profile = campaignProfileFromAnswers(answers);
  await db.query(
    `UPDATE brands
        SET brand_type = 'political',
            campaign_profile = $1::jsonb,
            updated_at = NOW()
      WHERE brand_id = $2 AND user_id = $3`,
    [JSON.stringify(profile), brandId, userId],
  );
  return true;
}

async function reloadSession(sessionId) {
  const { rows } = await db.query("SELECT * FROM setup_sessions WHERE session_id = $1", [sessionId]);
  return rows[0];
}

// Persist completed_steps for an in-flight run, but ONLY while the session is
// still 'in_progress'. A concurrent /pause or /dismiss (which flip status with a
// plain UPDATE that does not consult the execution lease) may commit while this
// step is genuinely mid-run; the status guard makes this write a no-op in that
// case so an in-flight step can never clobber a lifecycle change the user just
// made. Returns the updated row, or null when the session is no longer runnable.
// 026-C1: alongside completed_steps, the SAME status-guarded UPDATE records
// HOW each step completed ('completed' | 'skipped') in answers.step_outcomes
// (zero DDL — answers is existing JSONB). One atomic write, so a reload can
// never see a completed step without its truthful outcome.
async function writeCompletedSteps(sessionId, completed, outcomeEntry) {
  if (outcomeEntry && outcomeEntry.key) {
    const { rows } = await db.query(
      `UPDATE setup_sessions
         SET completed_steps = $1::jsonb,
             answers = jsonb_set(
               COALESCE(answers, '{}'::jsonb),
               '{step_outcomes}',
               COALESCE(answers->'step_outcomes', '{}'::jsonb) || $3::jsonb
             ),
             updated_at = NOW()
       WHERE session_id = $2 AND status = 'in_progress'
       RETURNING *`,
      [
        JSON.stringify(completed),
        sessionId,
        JSON.stringify({ [outcomeEntry.key]: outcomeEntry.outcome }),
      ],
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    `UPDATE setup_sessions SET completed_steps = $1::jsonb, updated_at = NOW()
       WHERE session_id = $2 AND status = 'in_progress'
       RETURNING *`,
    [JSON.stringify(completed), sessionId],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// 026-C2: durable failed step outcomes
// ---------------------------------------------------------------------------
// When a setup action throws, the failure must become a DURABLE, owner-safe
// record — never a console-only log the browser can't see (the SDS-H1 Step 5
// freeze). The outcome lives in answers.step_outcomes[stepKey] (existing JSONB,
// zero DDL) as an object: { status:'failed', at, code, message, retryable, ref }.
// The failed step is NEVER added to completed_steps — it stays the current
// runnable step, so a later retry that succeeds overwrites the failed outcome
// via the same writeCompletedSteps merge.
//
// AM-C2-1 (owner-safe by construction): the stored message and the HTTP error
// are chosen from fixed templates below. Raw provider/SDK text (billing
// details, stack traces, tokens) NEVER enters step_outcomes or any response —
// it goes to the server log only, tied to the browser-visible record by an
// opaque `ref`.

const STEP_FAILURE_TEMPLATES = {
  provider_billing:
    "Echo's AI service needs attention on our side before this step can finish. Your progress is saved — nothing was lost. Please try again later, or contact support if this persists.",
  provider_unavailable:
    "The AI service was temporarily unavailable while running this step. Your progress is saved — you can retry now.",
  step_input_invalid:
    "This step couldn't run with the information provided. Your progress is saved — you can retry, or skip this step and set it up later from your dashboard.",
  internal_error:
    "Something went wrong while running this step. Your progress is saved — you can retry.",
  // 026-C3 (I-61): an owner-fixable precondition — never presented as an AI
  // outage and never labeled retryable-as-is. Used only when a marked error
  // somehow reaches the failure path without its authored safeMessage.
  owner_action_required:
    "This step needs a quick choice from you before it can run. Nothing failed — finish the setup choice shown above, then continue.",
  // 026-C3-PM5 (Defect 1): a TERMINAL provider permission/restriction failure
  // (e.g. Meta rejecting ad creation because the ad account is restricted).
  // This is NEVER an AI outage and NEVER retryable-as-is: the fix lives in the
  // provider's console (owner/provider attention), so no Retry is offered and
  // nothing re-executes automatically. No raw provider codes/subcodes here —
  // raw evidence stays server-side in the logs and ledgers, joined by ref.
  provider_permission:
    "Facebook couldn't accept this ad campaign because the connected ad account needs attention on Facebook's side (a permission or account restriction). Everything Echo prepared is saved, and Echo will not retry automatically — resolve the restriction in Meta Business Manager, and this can be picked up from there.",
  // 026-C3-PM5 (Defect 2 / D-40 dirty evidence): a prior launch attempt left
  // partial provider evidence (failed/manual-review). The truthful resting
  // state: not complete, not "already set up", never auto-retried.
  provider_manual_review:
    "Your first ad campaign didn't finish launching and needs a manual review. Everything from the earlier attempt is saved, and Echo will not retry automatically until it's resolved.",
};

// Classifies a thrown step error into an owner-safe outcome. Uses only status
// codes and coarse keyword sniffing on the SERVER side — the matched raw text
// itself never leaves the server.
function classifyStepError(err) {
  const statusCode = err && err.statusCode;
  const raw = String((err && err.message) || "").toLowerCase();
  // 026-C3 (I-61): marker-first. An explicitly authored owner-action
  // precondition (e.g. resolveBrandAdDestination's deliberate 503) is checked
  // BEFORE the billing regex and BEFORE any status-code class, so it can never
  // masquerade as "AI service unavailable" again. Only the marker's authored
  // safeMessage may reach the browser — err.message is never generically
  // trusted (unmarked errors keep the bounded templates below).
  if (err && err.ownerActionRequired === true) {
    return {
      code: "owner_action_required",
      retryable: false,
      safeMessage: typeof err.safeMessage === "string" ? err.safeMessage : null,
    };
  }
  // 026-C3-PM5 §6/§7 — marker-first, BEFORE any status-code class, so a
  // terminal provider permission failure can never fall through to the 5xx
  // branch and masquerade as "AI service unavailable" (the live Defect 1).
  // Only the bounded templates render — raw provider text never leaves the
  // server; markers are set solely at trusted classification sites
  // (campaignController's terminal-provider marking, the PM5 dirty-evidence
  // recognizer below).
  if (err && err.providerPermission === true) {
    return { code: "provider_permission", retryable: false, safeMessage: null };
  }
  if (err && err.providerManualReview === true) {
    return { code: "provider_manual_review", retryable: false, safeMessage: null };
  }
  if (
    /credit balance|billing|purchase credits|payment required|quota exceeded|insufficient credit/.test(
      raw,
    )
  ) {
    // Operator-action-required provider/billing fault (the diagnosed SDS-H1
    // class). Retryable once the operator resolves it.
    return { code: "provider_billing", retryable: true };
  }
  if (statusCode === 502 || statusCode === 503 || (typeof err?.status === "number" && err.status >= 500)) {
    return { code: "provider_unavailable", retryable: true };
  }
  if (statusCode === 400 || statusCode === 422) {
    return { code: "step_input_invalid", retryable: false };
  }
  return { code: "internal_error", retryable: true };
}

// Persist a failed outcome for a step WITHOUT touching completed_steps.
// Status-guarded exactly like writeCompletedSteps: a pause/dismiss that raced
// this step and won makes this a no-op (caller falls back to
// respondCancelledMidStep). Returns the updated row, or null.
async function writeFailedOutcome(sessionId, stepKey, outcome) {
  const { rows } = await db.query(
    `UPDATE setup_sessions
       SET answers = jsonb_set(
             COALESCE(answers, '{}'::jsonb),
             '{step_outcomes}',
             COALESCE(answers->'step_outcomes', '{}'::jsonb) || $2::jsonb
           ),
           updated_at = NOW()
     WHERE session_id = $1 AND status = 'in_progress'
     RETURNING *`,
    [sessionId, JSON.stringify({ [stepKey]: outcome })],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// 026-C3-PM5 — canonical create_facebook_campaign completion predicate.
// ---------------------------------------------------------------------------
// DUPLICATE PREVENTION IS NOT SUCCESS EVIDENCE. The old recognizer reused the
// existence precheck ("any campaigns row for this brand") as the completion
// predicate, which presented a launch_failed partial chain as "already set
// up" (the live Defect 2). This predicate reuses the EXISTING Prompt-018
// evidence model — no parallel success definition:
//   1. campaigns row in a success domain state ('created_paused' | 'live' |
//      'completed' — utils/campaignState machine; launch_failed is failure);
//   2. the FULL provider chain persisted: facebook_campaign_id,
//      facebook_adset_id, facebook_creative_id, facebook_ad_id all present
//      (D-27 §11 — partial ids are never a chain);
//   3. the canonical ad_launch spine task (task_type 'ad_launch',
//      source_type 'campaign', source_id = campaign_id) reached a
//      SPINE_SUCCESS_STATE ('EXTERNALLY_VERIFIED'|'REPORTED'|'COMPLETED')
//      WITH proof_id — i.e. the Prompt-005 provider read-back verified the
//      launch and wrote its external_proofs row (utils/honestStatus rule:
//      spine success without proof lineage is never verified success);
//   4. the executeExternal ledger for this launch, when present, recorded
//      'succeeded' — a failed/terminal external_actions row with no
//      succeeded row is dirty evidence, never completion. (Launches adopted
//      before the ledger existed have no row at all; for those the spine
//      proof of §3 is the authoritative equivalent, so absence alone does
//      not veto — but recorded failure always does.)
// Fail CLOSED: if evidence cannot be read, the step is NOT complete.
async function facebookCampaignLaunchComplete(brandId) {
  if (!brandId) return { complete: false, dirty: false };
  try {
    const { rows } = await db.query(
      `SELECT c.campaign_id, c.status,
              (c.facebook_campaign_id IS NOT NULL AND c.facebook_adset_id IS NOT NULL
               AND c.facebook_creative_id IS NOT NULL AND c.facebook_ad_id IS NOT NULL) AS full_chain,
              t.status AS task_status, t.proof_id,
              (SELECT ea.status FROM external_actions ea
                WHERE ea.idempotency_key = 'ad_launch:' || c.campaign_id::text
                ORDER BY ea.created_at DESC LIMIT 1) AS ledger_status
         FROM campaigns c
         LEFT JOIN agent_tasks t
           ON t.task_type = 'ad_launch' AND t.source_type = 'campaign'
          AND t.source_id = c.campaign_id::text
        WHERE c.brand_id = $1`,
      [brandId],
    );
    if (rows.length === 0) return { complete: false, dirty: false };
    const SUCCESS_CAMPAIGN_STATES = ["created_paused", "live", "completed"];
    const SPINE_SUCCESS_STATES = ["EXTERNALLY_VERIFIED", "REPORTED", "COMPLETED"];
    const complete = rows.some(
      (r) =>
        SUCCESS_CAMPAIGN_STATES.includes(r.status) &&
        r.full_chain === true &&
        SPINE_SUCCESS_STATES.includes(r.task_status) &&
        r.proof_id != null &&
        (r.ledger_status == null || r.ledger_status === "succeeded"),
    );
    // Any campaigns row that is not part of a proven-complete launch is
    // DIRTY prior evidence (D-40): it blocks automatic re-execution.
    return { complete, dirty: !complete };
  } catch (err) {
    // Fail CLOSED both ways: not provably complete, and not provably clean.
    console.error("PM5 launch-evidence read failed:", err.message);
    return { complete: false, dirty: true, readFailed: true };
  }
}

// 026-C3-PM6 — an owner deferral is journey state, never launch success.
// Only the live partial-launch failure class may take this branch.  Generic
// skips keep their existing string outcome, while every original failure field
// (especially the correlation ref) survives unchanged in this SAME object.
function isDeferrableFailedOutcome(stepKey, outcome) {
  return Boolean(
    stepKey === "create_facebook_campaign" &&
    outcome &&
    typeof outcome === "object" &&
    !Array.isArray(outcome) &&
    outcome.status === "failed" &&
    outcome.code === "provider_manual_review" &&
    outcome.retryable === false &&
    typeof outcome.message === "string" &&
    outcome.message.length > 0 &&
    typeof outcome.ref === "string" &&
    outcome.ref.length > 0
  );
}

function isValidOwnerDirectedDeferral(outcome) {
  return (
    isDeferrableFailedOutcome("create_facebook_campaign", outcome) &&
    outcome.journey_disposition === "deferred" &&
    outcome.deferred_reason === "pending_provider_review" &&
    outcome.owner_directed === true &&
    typeof outcome.deferred_at === "string" &&
    Number.isFinite(Date.parse(outcome.deferred_at))
  );
}

function enrichOwnerDirectedDeferral(outcome, deferredAt = new Date().toISOString()) {
  if (!isDeferrableFailedOutcome("create_facebook_campaign", outcome)) return null;
  if (isValidOwnerDirectedDeferral(outcome)) return { ...outcome };
  return {
    ...outcome,
    journey_disposition: "deferred",
    deferred_reason: "pending_provider_review",
    deferred_at: deferredAt,
    owner_directed: true,
  };
}

// 026-C3-PM5 §5 — completed_steps reconciliation (operational state only).
// completed_steps is runner state, NOT launch evidence. If it claims
// create_facebook_campaign while the authoritative evidence above says the
// launch is not complete AND prior attempt evidence exists, the marker is
// removed and the truthful failed/manual-review outcome is recorded — one
// atomic, status-guarded UPDATE through the same JSONB paths the runner
// uses. Idempotent by construction: the second run finds the marker gone and
// does nothing. Preserves ALL evidence (campaigns rows, provider ids,
// ledgers, tasks, proofs are never touched).
async function reconcileCompletedSteps(session) {
  const STEP = "create_facebook_campaign";
  const completed = Array.isArray(session.completed_steps) ? session.completed_steps : [];
  if (!completed.includes(STEP) || !session.brand_id) return session;
  const evidence = await facebookCampaignLaunchComplete(session.brand_id);
  if (evidence.complete || !evidence.dirty) return session;
  const existingOutcome =
    session.answers &&
    session.answers.step_outcomes &&
    session.answers.step_outcomes[STEP];
  // PM6: completed membership is valid runner-terminal state when (and ONLY
  // when) the original failed/manual-review object carries the complete,
  // owner-directed deferral contract.  It is still not provider success.
  if (isValidOwnerDirectedDeferral(existingOutcome)) return session;
  const ref = crypto.randomUUID();
  const outcome = {
    status: "failed",
    at: new Date().toISOString(),
    code: "provider_manual_review",
    message: STEP_FAILURE_TEMPLATES.provider_manual_review,
    retryable: false,
    ref,
    correctedFrom: "completed_steps",
  };
  const { rows } = await db.query(
    `UPDATE setup_sessions
       SET completed_steps = (completed_steps - $2),
           answers = jsonb_set(
             COALESCE(answers, '{}'::jsonb),
             '{step_outcomes}',
             COALESCE(answers->'step_outcomes', '{}'::jsonb) || $3::jsonb
           ),
           updated_at = NOW()
     WHERE session_id = $1 AND status = 'in_progress'
       AND completed_steps ? $2
     RETURNING *`,
    [session.session_id, STEP, JSON.stringify({ [STEP]: outcome })],
  );
  if (rows[0]) {
    console.error(
      `Setup agent completed_steps corrected: "${STEP}" removed for session ${session.session_id} — authoritative launch evidence is failed/manual-review [ref ${ref}]`,
    );
    return rows[0];
  }
  return session;
}

// Uniform response when a lifecycle change (pause/dismiss) raced an in-flight
// step and won: report the session's real current state instead of pretending
// the step advanced the run. 409 = the execute conflicted with that change.
async function respondCancelledMidStep(res, sessionId) {
  const current = await reloadSession(sessionId);
  return res.status(409).json({
    error: "This setup session was paused or dismissed while a step was running.",
    session: serializeSession(current),
  });
}

/**
 * Ordered action definitions. `feature` (a key in config/tiers FEATURES) gates the
 * action; null means baseline (available on every paid plan). Each `run` returns
 * { status: 'done'|'skipped', detail }.
 */
const ACTIONS = [
  {
    key: "create_brand_profile",
    label: "Creating your brand & profile",
    feature: null,
    async run({ userId, session, answers }) {
      // P035-C1: an early interview-created brand no longer short-circuits
      // this step — the synthesis pipeline must still run, UPDATING that same
      // brand (saveProfile updates in place when the discovery session
      // carries a brand id). A brand bound WITH a completed discovery session
      // is a true re-run and stays idempotent.
      if (session.brand_id && session.discovery_session_id) {
        const done = await db.query(
          "SELECT status FROM brand_discovery_sessions WHERE session_id = $1 AND user_id = $2",
          [session.discovery_session_id, userId],
        );
        if (done.rows.length && done.rows[0].status === "completed") {
          return { status: "done", detail: "Your brand is already set up." };
        }
        // Crash between seed and confirm: fall through and confirm again —
        // the discovery row is bound to this brand, so saveProfile updates it.
      }
      // Crash-replay safety: this is the first action and it has an external side
      // effect (brand creation). We persist the brand-discovery session id BEFORE
      // confirming, so a retry after a crash can recover the already-created brand
      // (via the discovery row's brand_id) instead of creating a duplicate.
      let discoverySessionId = session.discovery_session_id || null;
      if (discoverySessionId && !session.brand_id) {
        const prior = await db.query(
          "SELECT brand_id FROM brand_discovery_sessions WHERE session_id = $1 AND user_id = $2",
          [discoverySessionId, userId],
        );
        const recoveredBrandId = prior.rows[0] && prior.rows[0].brand_id;
        if (recoveredBrandId) {
          await db.query("UPDATE setup_sessions SET brand_id = $1 WHERE session_id = $2", [
            recoveredBrandId,
            session.session_id,
          ]);
          session.brand_id = recoveredBrandId;
          const politicalRecovered = await applyPoliticalProfile(userId, recoveredBrandId, answers);
          if (!politicalRecovered) {
            await applyRealEstateProfile(userId, recoveredBrandId, answers);
          }
          await applyOnlinePresence(userId, recoveredBrandId, answers);
          // Crash recovery must perform the SAME durable handoff as the normal
          // path (Section C) — both calls are idempotent (unchanged values are
          // skipped; identical anchors are a no-op), so a re-run is safe.
          await applyStatedFacts(userId, recoveredBrandId, answers);
          anchorOrchestrator.onAnchorArrival({
            userId,
            brandId: recoveredBrandId,
            reason: "setup_interview",
          });
          return { status: "done", detail: "Your brand profile is already set up." };
        }
      } else if (!discoverySessionId) {
        // Seed a brand-discovery session with the interview answers, then run the
        // existing discovery confirm path so the brand + full profile are created
        // through the exact same synthesis pipeline the UI uses.
        // P035-C1: when the interview already created the onboarding brand,
        // the discovery session is seeded WITH that brand id so the accepted
        // synthesis pipeline UPDATES it instead of inserting a duplicate.
        const seeded = [{ role: "user", content: compiledBusinessSummary(answers) }];
        const { rows } = await db.query(
          `INSERT INTO brand_discovery_sessions (user_id, brand_id, messages)
           VALUES ($1, $2, $3::jsonb)
           RETURNING session_id`,
          [userId, session.brand_id || null, JSON.stringify(seeded)],
        );
        discoverySessionId = rows[0].session_id;
        await db.query(
          "UPDATE setup_sessions SET discovery_session_id = $1 WHERE session_id = $2",
          [discoverySessionId, session.session_id],
        );
        session.discovery_session_id = discoverySessionId;
      }

      const result = await invoke(brandDiscoveryController.discovery, userId, {
        body: { sessionId: discoverySessionId, confirm: true },
      });
      const payload = ensureOk(result, "Failed to create your brand profile.");
      const brand = payload.brand;
      if (!brand || !brand.brand_id) {
        throw upstreamError("The brand profile could not be created. Please try again.");
      }

      await db.query("UPDATE setup_sessions SET brand_id = $1 WHERE session_id = $2", [
        brand.brand_id,
        session.session_id,
      ]);
      session.brand_id = brand.brand_id;
      const political = await applyPoliticalProfile(userId, brand.brand_id, answers);
      const realEstate = political
        ? false
        : await applyRealEstateProfile(userId, brand.brand_id, answers);
      await applyOnlinePresence(userId, brand.brand_id, answers);
      // Prompt 035 Section C — durable owner-fact handoff (verbatim answers →
      // stated knowledge versions). Runs after online presence so knowledge
      // and brand anchors land together.
      await applyStatedFacts(userId, brand.brand_id, answers);
      // Prompt 035 Sections D/E — anchors just arrived (name, maybe website/
      // facebook). Kick the onboarding investigation orchestrator; it is
      // fire-and-forget and never blocks or fails the setup step.
      anchorOrchestrator.onAnchorArrival({
        userId,
        brandId: brand.brand_id,
        reason: "setup_interview",
      });
      return {
        status: "done",
        detail: political
          ? `Created "${brand.brand_name}" as a political campaign with a full campaign profile.`
          : realEstate
            ? `Created "${brand.brand_name}" as a real estate practice with a full agent profile.`
            : `Created "${brand.brand_name}" with a full brand profile.`,
      };
    },
  },

  {
    key: "set_availability",
    label: "Setting your booking availability",
    feature: "appointments",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      const timezone = firstAnswer(answers, ["timezone", "time_zone"]) || "America/New_York";
      const durationRaw = firstAnswer(answers, ["duration", "appointment"]);
      const parsedDuration = parseInt(durationRaw, 10);
      const slotDurationMinutes =
        Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 30;

      // Prompt 035 Section C3 — the owner's explicit hours answer is
      // authoritative. Deterministic parse only (C1-B); the default may fill
      // ONLY a genuinely unanswered field, and an answered-but-unparseable
      // value is reported honestly, never silently replaced.
      const rawHours = firstAnswer(answers, ["business_hours", "opening_hours", "hours"]);
      const answered = Boolean(rawHours) && !isRefusalAnswer(rawHours);
      const parsed = answered ? parseBusinessHours(rawHours) : null;
      if (answered && !parsed) {
        // The owner DID answer but the deterministic parser can't read it.
        // Section C3: a default may fill only a genuinely unanswered field —
        // writing ANY placeholder schedule over explicit input is prohibited,
        // even disclosed. Leave availability unset and ask for review; the
        // exact wording is already saved verbatim in the knowledge substrate.
        return {
          status: "skipped",
          detail: `I couldn't read "${rawHours.slice(0, 60)}" as structured hours, so I left your booking availability unset rather than guess. Your exact wording is saved — please set your hours under Appointments.`,
        };
      }
      const weeklyHours = parsed ? parsed.weeklyHours : DEFAULT_WEEKLY_HOURS;

      const result = await invoke(appointmentController.saveAvailabilityConfig, userId, {
        params: { brandId: session.brand_id },
        body: {
          timezone,
          slotDurationMinutes,
          bufferMinutes: 0,
          weeklyHours,
        },
      });
      ensureOk(result, "Failed to set your availability.");
      let detail;
      if (parsed) {
        const first = parsed.weeklyHours[0];
        detail = `Set your stated hours (${first.start}–${first.end}, ${parsed.weeklyHours.length} day${parsed.weeklyHours.length === 1 ? "" : "s"}/week) with ${slotDurationMinutes}-minute appointments.`;
      } else if (answered) {
        detail = `Couldn't read "${rawHours.slice(0, 60)}" as structured hours — set a weekday 9–5 placeholder. Your exact wording is saved; please review it under Appointments.`;
      } else {
        detail = `Set weekday hours (9–5) with ${slotDurationMinutes}-minute appointments.`;
      }
      return { status: "done", detail };
    },
  },

  {
    key: "connect_google",
    label: "Connecting Google Calendar",
    feature: null,
    async run({ userId }) {
      // OAuth is user-driven by design — we never capture Google credentials. We
      // only report whether it's already connected; the UI hands off to Google's
      // own consent screen when it isn't.
      try {
        const { rows } = await db.query(
          "SELECT 1 FROM google_integrations WHERE user_id = $1 AND connection_status = 'connected'",
          [userId],
        );
        if (rows.length > 0) {
          return { status: "done", detail: "Google Calendar is connected." };
        }
      } catch (err) {
        // Table/shape surprise — degrade to a connection handoff rather than fail.
      }
      return {
        status: "needs_connection",
        connect: "google",
        detail: "Connect Google Calendar so Zorecho can sync your bookings.",
      };
    },
  },

  {
    key: "content_calendar",
    label: "Building your content calendar",
    feature: "content_calendar",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: if a calendar already exists for this brand (e.g. a retry
      // after a crash between the side effect and the completed-steps write), don't
      // create a duplicate.
      const existingCal = await db.query(
        "SELECT 1 FROM content_calendars WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existingCal.rows.length > 0) {
        return { status: "done", detail: "Your content calendar is already set up." };
      }
      const postingFrequency = pickFrequency(answers);
      const platforms = pickPlatforms(answers);
      const contentTheme =
        firstAnswer(answers, ["theme", "content"]) ||
        firstAnswer(answers, ["goal"]) ||
        "Brand awareness and lead generation";
      const businessType = firstAnswer(answers, ["business", "offering", "product", "service"]);

      const genResult = await invoke(contentCalendarController.generateCalendar, userId, {
        body: { brandId: session.brand_id, postingFrequency, platforms, contentTheme, businessType },
      });
      const gen = ensureOk(genResult, "Failed to generate your content calendar.");
      if (!Array.isArray(gen.posts) || gen.posts.length === 0) {
        throw upstreamError("The content calendar came back empty. Please try again.");
      }

      const saveResult = await invoke(contentCalendarController.saveCalendar, userId, {
        body: { brandId: session.brand_id, postingFrequency, contentTheme, posts: gen.posts },
      });
      ensureOk(saveResult, "Failed to save your content calendar.");
      return {
        status: "done",
        detail: `Drafted ${gen.posts.length} posts across ${platforms.join(", ")}.`,
      };
    },
  },

  {
    key: "ad_creatives",
    label: "Generating your first ad creatives",
    feature: "ad_studio",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: don't regenerate creatives if this brand already has some.
      const existingCreatives = await db.query(
        "SELECT 1 FROM ad_creatives WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existingCreatives.rows.length > 0) {
        return { status: "done", detail: "Your ad creatives are already generated." };
      }
      const campaignGoal = pickCampaignGoal(answers);
      const budgetRange = firstAnswer(answers, ["budget"]);
      const productFocus = firstAnswer(answers, ["product", "offering", "focus", "service"]);

      const genResult = await invoke(adCreativeStudioController.generateCreatives, userId, {
        body: { brandId: session.brand_id, campaignGoal, budgetRange, productFocus },
      });
      const gen = ensureOk(genResult, "Failed to generate ad creatives.");
      if (!Array.isArray(gen.packages) || gen.packages.length === 0) {
        throw upstreamError("The ad creatives came back empty. Please try again.");
      }

      const saveResult = await invoke(adCreativeStudioController.saveCreative, userId, {
        body: {
          brandId: session.brand_id,
          campaignGoal,
          packages: gen.packages,
          budgetRange,
          productFocus,
        },
      });
      ensureOk(saveResult, "Failed to save ad creatives.");
      return {
        status: "done",
        detail: `Generated ${gen.packages.length} ad creative packages.`,
      };
    },
  },

  {
    key: "create_facebook_campaign",
    label: "Creating your first Facebook ad campaign",
    feature: null,
    async run({ userId, session, answers, confirm }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // 026-C3-PM5: duplicate prevention and success recognition are now
      // SEPARATE questions answered by the same evidence read.
      //   - COMPLETE (full canonical evidence chain) → done, truthfully.
      //   - DIRTY (any prior attempt evidence short of that) → D-40: never
      //     execute again, never create provider objects, never say "already
      //     set up" — surface the truthful failed/manual-review resting state
      //     (classifyStepError maps the marker to provider_manual_review,
      //     retryable false, so no Retry affordance renders).
      //   - NO evidence at all → first attempt may proceed below.
      const evidence = await facebookCampaignLaunchComplete(session.brand_id);
      if (evidence.complete) {
        return { status: "done", detail: "Your first ad campaign is already set up." };
      }
      if (evidence.dirty) {
        const dirtyErr = new Error(
          "Prior ad-launch attempt evidence exists for this brand (failed/manual-review) — automatic re-execution is blocked.",
        );
        dirtyErr.providerManualReview = true;
        throw dirtyErr;
      }
      // A real Facebook ad campaign needs a connected ad account. Instead of
      // skipping (making the user hunt for Settings later), we hand off to the
      // existing Facebook OAuth right inside the setup flow. This step is
      // idempotent: once connected, re-running it launches the campaign — a
      // campaign is never faked.
      const connected = await db.query(
        `SELECT 1 FROM api_integrations
         WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected'`,
        [userId],
      );
      if (connected.rows.length === 0) {
        return {
          status: "needs_connection",
          connect: "facebook",
          detail:
            "Connect your Facebook account so Zorecho can launch your first ad campaign using the creatives we just generated.",
        };
      }

      const goal = pickCampaignGoal(answers);
      const budget = pickAdBudget(answers);
      const monthly = pickMonthlyAdBudget(answers);

      // -----------------------------------------------------------------
      // 026-C3 — THREE-STORE AUTHORITY MAP (do not merge these stores):
      //   STORE 1  api_integrations (user+platform): does this USER have
      //            Facebook credentials and granted Pages? page_ref is a
      //            wizard default suggestion only — launch paths never read it.
      //   STORE 2  social_accounts (brand+platform): which Page is bound to
      //            this BRAND for social PUBLISHING. Never a fallback for ads.
      //   STORE 3  brands.facebook_page_id + brands.ad_link_url (brand):
      //            which Page/destination this BRAND's ADS use. This step
      //            coordinates STORE 3 only, via the existing product writers
      //            (POST /api/facebook/select-page, PUT /api/brands/:id).
      // -----------------------------------------------------------------
      // 026-C3 (I-62) preflight: Facebook is connected, so a missing Page or
      // destination is a PREDICTABLE owner setup choice — pause and solicit
      // it, never fall through to a launch path whose guard must fail. This
      // pause is re-derived from live brand state on every execute (no
      // durable failure, no VALIDATION_FAILED artifact, nothing completed).
      const gateBrand = await db.query(
        "SELECT facebook_page_id, ad_link_url FROM brands WHERE brand_id = $1",
        [session.brand_id],
      );
      const brandDest = gateBrand.rows[0] || {};
      if (!brandDest.facebook_page_id || !brandDest.ad_link_url) {
        return {
          status: "owner_action_required",
          action: {
            code: "missing_ad_destination",
            missing: {
              page: !brandDest.facebook_page_id,
              destination: !brandDest.ad_link_url,
            },
          },
          detail:
            "Before I can set up your first ad campaign, choose the Facebook Page your ads will run from and confirm where clicks should go.",
        };
      }

      // 026-C3 AM-C3-2: configuration ≠ launch authorization. Before ANY
      // externally-capable campaign branch may run, the owner must explicitly
      // authorize THIS launch. The summary and its digest come from CURRENT
      // SERVER TRUTH (never client state); the confirmation is artifact-bound
      // exactly like the C1 social_schedule approval: a digest mismatch (the
      // configuration changed between review and approval) re-pauses with a
      // fresh summary instead of launching something the owner never saw.
      // One-shot by construction: the confirm rides exactly one execute call
      // (the client clears it before sending), is validated against live
      // truth here, and the existing campaigns-exist idempotency precheck
      // above means a consumed authorization can never produce a second
      // provider-object attempt.
      const integ = await db.query(
        `SELECT account_ref, facebook_pages FROM api_integrations
         WHERE user_id = $1 AND platform = 'facebook'`,
        [userId],
      );
      const integRow = integ.rows[0] || {};
      const grantedPages = Array.isArray(integRow.facebook_pages)
        ? integRow.facebook_pages
        : [];
      const pageMeta = grantedPages.find((p) => p && p.id === brandDest.facebook_page_id);
      const launchSummary = {
        pageId: brandDest.facebook_page_id,
        pageName: (pageMeta && pageMeta.name) || null,
        adAccount: integRow.account_ref || null,
        destination: brandDest.ad_link_url,
        dailyBudget: budget,
        createdPaused: true,
        initialSpend: 0,
      };
      const launchDigest = crypto
        .createHash("sha256")
        .update(
          [
            session.brand_id,
            launchSummary.pageId,
            launchSummary.adAccount || "",
            launchSummary.destination,
            String(budget),
          ].join("|"),
        )
        .digest("hex");
      const launchConfirmed =
        confirm &&
        confirm.step === "create_facebook_campaign" &&
        typeof confirm.digest === "string" &&
        confirm.digest === launchDigest;
      if (!launchConfirmed) {
        const stale =
          confirm && confirm.step === "create_facebook_campaign" && confirm.digest
            ? true
            : false;
        return {
          status: "owner_action_required",
          action: {
            code: "confirm_campaign_launch",
            summary: launchSummary,
            digest: launchDigest,
            changed: stale,
          },
          detail: stale
            ? "Your ads setup changed since you reviewed it — please look at the update and authorize again."
            : "Everything is configured. Review the summary and authorize creating your first campaign — it will be created PAUSED with $0 spent.",
        };
      }

      // Prefer launching the AI-generated creative from the ad_creatives step so
      // the campaign runs the real ad we just built (image concept, copy,
      // audience). This only works when Facebook ad creation is fully configured
      // (Page + destination link); otherwise fall back to a standard campaign.
      const latestCreative = await db.query(
        `SELECT creative_id FROM ad_creatives
         WHERE brand_id = $1 AND status <> 'launched'
         ORDER BY created_at DESC LIMIT 1`,
        [session.brand_id],
      );
      const creativeId = latestCreative.rows[0] && latestCreative.rows[0].creative_id;
      const canLaunchCreative = Boolean(creativeId);

      if (canLaunchCreative) {
        const launched = await invoke(adCreativeStudioController.launchCreative, userId, {
          body: { creativeId, packageIndex: 0, budget, origin: "setup_wizard" },
        });
        ensureOk(launched, "Failed to launch your first Facebook ad campaign.");
        return {
          status: "done",
          detail: monthly
            ? `Launched a paused Facebook ad campaign from your generated creative at $${budget}/day, within your $${monthly}/month budget, ready for review.`
            : `Launched a paused Facebook ad campaign from your generated creative ($${budget}/day) ready for review.`,
        };
      }

      const result = await invoke(campaignController.createCampaign, userId, {
        body: { brandId: session.brand_id, goal, budget, targetAudience: {}, origin: "setup_wizard" },
      });
      ensureOk(result, "Failed to create your first Facebook ad campaign.");
      return {
        status: "done",
        detail: monthly
          ? `Launched a paused Facebook ad campaign at $${budget}/day, within your $${monthly}/month budget, ready for review.`
          : `Launched a paused Facebook ad campaign ($${budget}/day) ready for review.`,
      };
    },
  },

  {
    key: "setup_google_ads",
    label: "Setting up your Google Ads campaign",
    feature: null,
    async run({ session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Opt-in gate: only runs when the user said yes to Google ads in the
      // interview — otherwise skip gracefully (they can add them anytime).
      if (!wantsGoogleAds(answers)) {
        return {
          status: "skipped",
          detail: "You chose not to run Google ads for now — you can add them anytime.",
        };
      }
      // Idempotency: don't regenerate a plan on a retry after a crash between the
      // AI call and the completed-steps write.
      const existing = await db.query(
        "SELECT 1 FROM google_ad_plans WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existing.rows.length > 0) {
        return { status: "done", detail: "Your Google Ads campaign plan is already set up." };
      }

      const topic = googleAdsTopic(answers);
      // The brand's configured geographic targeting wins over interview answers
      // so the Google plan always matches the compliance-approved service area.
      let location = firstAnswer(answers, [
        "location",
        "service_area",
        "area",
        "city",
        "region",
        "state",
        "market",
      ]) || null;
      try {
        const { rows: geoRows } = await db.query(
          "SELECT geo_targeting FROM brands WHERE brand_id = $1 AND user_id = $2",
          [session.brand_id, session.user_id],
        );
        const geoSummary = geoSummaryText(geoRows[0] && geoRows[0].geo_targeting);
        if (geoSummary) location = geoSummary.slice(0, 500);
      } catch (e) {
        console.error("google plan geo lookup failed:", e.message);
      }
      const monthlyBudget = pickMonthlyAdBudget(answers);

      // Real AI keyword research — no mocked data. Upstream failures map to 502.
      let keywords;
      try {
        keywords = await generateKeywordSuggestions(topic);
      } catch (err) {
        throw upstreamError(
          "Could not generate your Google Ads keyword plan right now. Please try again shortly.",
        );
      }
      if (!Array.isArray(keywords) || keywords.length === 0) {
        throw upstreamError(
          "The Google Ads keyword research came back empty. Please try again shortly.",
        );
      }

      // brand_id is UNIQUE; ON CONFLICT backstops a concurrent double-run.
      await db.query(
        `INSERT INTO google_ad_plans (brand_id, location, monthly_budget, keywords, status)
         VALUES ($1, $2, $3, $4, 'draft')
         ON CONFLICT (brand_id) DO NOTHING`,
        [session.brand_id, location, monthlyBudget, JSON.stringify(keywords)],
      );
      return {
        status: "done",
        detail: `Built a Google Ads keyword plan (${keywords.length} target keywords) ready for review.`,
      };
    },
  },

  {
    key: "connect_social",
    label: "Connecting your social accounts",
    feature: null,
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Only prompt to connect posting accounts when there's actually a draft
      // calendar to publish — otherwise there's nothing to post yet, so we skip
      // gracefully (lower tiers without a calendar never see this).
      let hasCalendar = false;
      try {
        const { rows } = await db.query(
          `SELECT 1 FROM content_calendars
           WHERE brand_id = $1 AND status = 'draft' LIMIT 1`,
          [session.brand_id],
        );
        hasCalendar = rows.length > 0;
      } catch (err) {
        // fall through to skip
      }
      if (!hasCalendar) {
        return { status: "skipped", detail: "No content calendar to publish yet." };
      }

      // The platforms the user mentioned in the interview. Social posting uses
      // per-brand credentials (no one-click OAuth), so we hand off to the
      // existing Social Accounts screen. This step is idempotent: once at least
      // one mentioned account is connected, re-running it completes.
      //
      // 026-C1 AM-C1-1: three real states, checked honestly (Section D — a
      // failed lookup is a SYSTEM FAULT, never coerced into "not connected"):
      //   A) an explicit social_accounts binding exists      => done
      //   B) Facebook credentials exist (api_integrations)
      //      but this brand has NO Page binding              => Page picker
      //   C) nothing at all                                  => generic connect
      const platforms = pickPlatforms(answers);
      let connected = [];
      try {
        const { rows } = await db.query(
          `SELECT platform FROM social_accounts
           WHERE brand_id = $1 AND connection_status = 'connected' AND platform = ANY($2)`,
          [session.brand_id, platforms],
        );
        connected = rows.map((r) => r.platform);
      } catch (err) {
        err.systemFault = true;
        throw err;
      }
      if (connected.length > 0) {
        return {
          status: "done",
          detail: `Connected: ${connected.join(", ")}. Your scheduled posts will publish automatically.`,
        };
      }
      // State B: the user's Facebook login works (ads-side credentials are
      // stored), but this business has no Page selected as a posting
      // destination — route to the explicit Page picker, never a generic
      // "connect" that looks already-satisfied.
      if (platforms.includes("facebook")) {
        let hasFacebookCreds = false;
        try {
          const { rows } = await db.query(
            `SELECT 1 FROM api_integrations
             WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected'
             LIMIT 1`,
            [userId],
          );
          hasFacebookCreds = rows.length > 0;
        } catch (err) {
          err.systemFault = true;
          throw err;
        }
        if (hasFacebookCreds) {
          return {
            status: "needs_connection",
            connect: { type: "social_select_page", platforms, connected },
            detail:
              "Your Facebook login works, but this business has no Page selected yet — choose the Page your posts should publish to.",
          };
        }
      }
      return {
        status: "needs_connection",
        connect: { type: "social", platforms, connected },
        detail:
          "Connect the social accounts you want to post to so your scheduled posts publish automatically.",
      };
    },
  },

  {
    key: "social_schedule",
    label: "Scheduling your social posts",
    feature: null,
    async run({ userId, session, confirm }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Activate the most recent draft calendar. If none exists (lower tier
      // skipped the calendar), skip gracefully.
      //
      // 026-C1 Ruling A: activation now requires the owner's artifact-bound
      // approval. Without a confirmation, this step PAUSES with the preview
      // (needs_connection type 'activate_calendar') — it never activates on
      // its own. With a confirmation, it invokes the SAME digest-guarded
      // activateCalendar boundary as the manual calendar UI (R26).
      let calendarId = null;
      try {
        const { rows } = await db.query(
          `SELECT calendar_id FROM content_calendars
           WHERE brand_id = $1 AND status = 'draft'
           ORDER BY created_at DESC LIMIT 1`,
          [session.brand_id],
        );
        calendarId = rows[0] && rows[0].calendar_id;
      } catch (err) {
        err.systemFault = true;
        throw err;
      }
      if (!calendarId) {
        return {
          status: "skipped",
          detail: "Add a content calendar (Professional plan) to schedule posts.",
        };
      }
      const confirmed =
        confirm && confirm.step === "social_schedule" && typeof confirm.digest === "string"
          ? confirm.digest
          : null;
      if (!confirmed) {
        const previewResult = await invoke(contentCalendarController.previewActivation, userId, {
          body: { calendarId },
        });
        const preview = ensureOk(previewResult, "Failed to preview your posting schedule.");
        return {
          status: "needs_connection",
          connect: { type: "activate_calendar", calendarId, preview },
          detail: "Your posting schedule is ready — approve it to start auto-posting.",
        };
      }
      const result = await invoke(contentCalendarController.activateCalendar, userId, {
        body: { calendarId, confirmDigest: confirmed },
      });
      if (
        result.statusCode === 409 &&
        result.payload &&
        (result.payload.digestMismatch || result.payload.confirmationRequired)
      ) {
        // The calendar changed between review and approval (or the confirm was
        // malformed): pause again with the FRESH preview — never activate a
        // different artifact than the one the owner saw.
        return {
          status: "needs_connection",
          connect: {
            type: "activate_calendar",
            calendarId,
            preview: result.payload.preview,
            changed: true,
          },
          detail:
            "The schedule changed since you reviewed it — please look at the update and approve again.",
        };
      }
      const activation = ensureOk(result, "Failed to schedule your posts.");
      const parts = [`Scheduled ${activation.activatedCount} post${activation.activatedCount === 1 ? "" : "s"}.`];
      if (activation.excludedStaleCount > 0) {
        parts.push(`${activation.excludedStaleCount} stayed as drafts (their times had passed).`);
      }
      if (activation.excludedUnboundCount > 0) {
        parts.push(
          `${activation.excludedUnboundCount} stayed as drafts (no connected destination).`,
        );
      }
      return { status: "done", detail: parts.join(" ") };
    },
  },

  {
    key: "email_preferences",
    label: "Setting up your email campaigns",
    feature: "email_marketing",
    // If the AI drip designer fails even after its retries, don't stop setup —
    // record this step as skipped with a friendly, actionable message.
    skipMessage:
      "We'll set up your email campaigns later — you can do this from the Email Marketing section.",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: don't recreate the welcome series if one already exists.
      const existingSeries = await db.query(
        `SELECT 1 FROM email_marketing_campaigns
         WHERE brand_id = $1 AND campaign_name = 'Welcome Series' LIMIT 1`,
        [session.brand_id],
      );
      if (existingSeries.rows.length > 0) {
        return { status: "done", detail: "Your welcome email series is already set up." };
      }
      const goal =
        firstAnswer(answers, ["email"]) ||
        firstAnswer(answers, ["goal"]) ||
        "Welcome and nurture new leads";

      const genResult = await invoke(emailMarketingController.generateDripSequence, userId, {
        body: { brandId: session.brand_id, goal, audienceSegment: "all", numEmails: 3 },
      });
      const gen = ensureOk(genResult, "Failed to design your welcome emails.");
      if (!Array.isArray(gen.emails) || gen.emails.length < 2) {
        throw upstreamError("The welcome email sequence came back empty. Please try again.");
      }

      const saveResult = await invoke(emailMarketingController.createDripSequence, userId, {
        body: {
          brandId: session.brand_id,
          campaignName: "Welcome Series",
          goal,
          segment: "all",
          emails: gen.emails,
        },
      });
      ensureOk(saveResult, "Failed to save your welcome email sequence.");
      return { status: "done", detail: `Created a ${gen.emails.length}-email welcome series.` };
    },
  },

  {
    key: "create_survey",
    label: "Designing your first customer survey",
    feature: "feedback",
    async run({ userId, session }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: don't create a duplicate survey on a retry after a crash
      // between the side effect and the completed-steps write.
      const existingSurvey = await db.query(
        "SELECT 1 FROM surveys WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existingSurvey.rows.length > 0) {
        return { status: "done", detail: "Your customer survey is already set up." };
      }

      const result = await invoke(feedbackController.createSurvey, userId, {
        body: { brandId: session.brand_id, surveyType: "general" },
      });
      const payload = ensureOk(result, "Failed to design your customer survey.");
      const survey = payload.survey;
      if (!survey || !Array.isArray(survey.questions) || survey.questions.length === 0) {
        throw upstreamError("The customer survey came back empty. Please try again.");
      }
      return {
        status: "done",
        detail: `Designed a ${survey.questions.length}-question customer satisfaction survey.`,
      };
    },
  },
];

function actionMeta() {
  return ACTIONS.map((a) => ({ key: a.key, label: a.label }));
}

// ---------------------------------------------------------------------------
// Prompt 023 — adaptive interview over the four-state knowledge projection.
//
// "Interview action precedence is question selection, not an authority ranking."
//
// The pure gap engine (utils/interviewGapEngine) decides which knowledge field
// to surface and why; the AI only phrases the question. All owner resolutions
// write through the canonical Prompt-011 boundary (utils/brandKnowledge) —
// this controller NEVER writes brands knowledge columns directly.
// ---------------------------------------------------------------------------

/**
 * Resolve the brand an interview session is about: the session's brand when
 * set, else the user's single existing brand (a brand-new user has none —
 * every field is honestly "missing" and the engine runs in sparse mode).
 */
async function resolveInterviewBrand(userId, sessionBrandId) {
  if (sessionBrandId) {
    const r = await db.query("SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2", [
      sessionBrandId,
      userId,
    ]);
    if (r.rows.length) return r.rows[0];
  }
  const r = await db.query(
    "SELECT * FROM brands WHERE user_id = $1 AND (is_demo IS NOT TRUE) ORDER BY created_at ASC",
    [userId],
  );
  return r.rows.length === 1 ? r.rows[0] : null;
}

/**
 * Assemble the four-state projection (approved / pending / legacy / draft)
 * for the gap engine. Returns { brandId, draftId, inventory } or, when the
 * knowledge read fails, { readFailure: true } — a read failure is NEVER
 * treated as "all fields missing" (D-36 A7): the interview degrades to the
 * plain adaptive interview for that turn instead of re-interrogating truth.
 */
async function loadInterviewInventory(userId, sessionBrandId) {
  try {
    const brand = await resolveInterviewBrand(userId, sessionBrandId);
    if (!brand) {
      // Brand-new user: sparse mode — every field is honestly "missing" (the
      // engine still runs; answers stay in the session until the discovery
      // step creates the brand and writes them through the boundary).
      return { brandId: null, draftId: null, inventory: { approved: {}, pending: {}, legacy: {}, draft: {} } };
    }

    const approvedRaw = await knowledge.getApprovedKnowledge(brand.brand_id);
    const approved = {};
    for (const [k, v] of Object.entries(approvedRaw || {})) approved[k] = v;

    // Latest pending revision per field (unapproved proposals only).
    const pend = await db.query(
      `SELECT DISTINCT ON (field_key) *
         FROM brand_knowledge_revisions
        WHERE brand_id = $1 AND status = 'pending' AND kind = 'field'
        ORDER BY field_key, created_at DESC`,
      [brand.brand_id],
    );
    const pending = {};
    for (const r of pend.rows) {
      pending[r.field_key] = {
        revisionId: r.revision_id,
        proposedValue: r.proposed_value,
        provenance: r.provenance,
        sourceKind: r.source_kind,
      };
    }

    // Legacy unversioned brands values (only where no approved version exists).
    const legacy = {};
    for (const [fieldKey, col] of Object.entries(knowledge.FIELD_COLUMNS)) {
      if (approved[fieldKey]) continue;
      const raw = brand[col.column];
      if (raw === null || raw === undefined || raw === "") continue;
      legacy[fieldKey] = { value: raw };
    }

    // Latest usable research draft (unapproved evidence; complete/partial only).
    const d = await db.query(
      `SELECT draft_id, fields FROM sage_research_drafts
        WHERE brand_id = $1 AND status IN ('complete','partial')
        ORDER BY created_at DESC LIMIT 1`,
      [brand.brand_id],
    );
    const draft = {};
    let draftId = null;
    if (d.rows.length) {
      draftId = d.rows[0].draft_id;
      const fields = d.rows[0].fields || {};
      for (const [k, f] of Object.entries(fields)) {
        if (!f || typeof f !== "object") continue;
        draft[k] = {
          value: f.value,
          confidence: f.confidence,
          sources: f.sources,
          conflict: f.conflict === true,
          alternatives: f.alternatives,
        };
      }
    }

    return { brandId: brand.brand_id, draftId, inventory: { approved, pending, legacy, draft } };
  } catch (err) {
    console.error("Interview knowledge read failed (degrading to plain interview):", err.message);
    return { readFailure: true };
  }
}

/** Interview bookkeeping stored under the reserved answers key `_interview`. */
function interviewState(answers) {
  const raw = answers && typeof answers._interview === "object" && answers._interview !== null ? answers._interview : {};
  return {
    surfaces: raw.surfaces && typeof raw.surfaces === "object" ? raw.surfaces : {},
    resolved: raw.resolved && typeof raw.resolved === "object" ? raw.resolved : {},
    deferred: raw.deferred && typeof raw.deferred === "object" ? raw.deferred : {},
    premiseChanged: raw.premiseChanged && typeof raw.premiseChanged === "object" ? raw.premiseChanged : {},
    noticesShown: raw.noticesShown && typeof raw.noticesShown === "object" ? raw.noticesShown : {},
    continueAnyway: raw.continueAnyway === true,
    knowledgeReadFailed: raw.knowledgeReadFailed === true,
    // Prompt 035 Section H — explicit second-business entry intent, persisted
    // in the reserved answers._interview JSONB bookkeeping (NOT a SQL column;
    // the entry_intent column is not authorized). Survives pause/reload/
    // restart because answers is the session's durable JSONB state.
    entryIntent: raw.entryIntent === "new_business" ? "new_business" : raw.entryIntent === "resume" ? "resume" : null,
    // P035-C2 — volunteered-URL confirmation state (answers._interview JSONB;
    // no schema). queue: candidates awaiting explicit owner confirmation;
    // decided: normalized URL → "confirmed" | "rejected" (beyond-cap URLs are
    // NEVER entered here — AM-1); exchangeLog: bounded confirmation-turn
    // record (AM-3 — preservation, not inference).
    urlConfirm: normalizeUrlConfirm(raw.urlConfirm),
  };
}

function normalizeUrlConfirm(raw) {
  const uc = raw && typeof raw === "object" && raw !== null ? raw : {};
  return {
    queue: Array.isArray(uc.queue) ? uc.queue : [],
    decided: uc.decided && typeof uc.decided === "object" ? uc.decided : {},
    exchangeLog: Array.isArray(uc.exchangeLog) ? uc.exchangeLog : [],
    pendingOverflow: typeof uc.pendingOverflow === "number" ? uc.pendingOverflow : 0,
    // C2-PM1(b) — fail-honest bound accounting: how many exchange entries the
    // 20-entry cap has dropped from this log (never silently discarded).
    logDroppedCount: typeof uc.logDroppedCount === "number" ? uc.logDroppedCount : 0,
  };
}

function evidencePreview(value) {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

/**
 * Build the per-turn director note the AI receives. The ENGINE selected the
 * field and action; the AI only phrases it. Returns { note, target } where
 * target is the plan entry being surfaced (or null for a free operational
 * turn once all knowledge fields are settled).
 */
function buildDirectorNote(plan, state) {
  const target = gapEngine.nextField(plan, state);

  // Approved-field notices (closed vocabulary) are acknowledged honestly the
  // first time they arise; the approved value stays authoritative and only
  // the owner may choose to revisit it (never the engine, never the AI).
  const noticeLines = [];
  for (const entry of plan) {
    if (entry.notice === gapEngine.NOTICES.NONE) continue;
    if (state.noticesShown[entry.fieldKey]) continue;
    if (entry.notice === gapEngine.NOTICES.PENDING_REVIEW_EXISTS) {
      noticeLines.push(
        `NOTICE for "${entry.fieldKey}": the approved value is being used, but an unreviewed change proposal is waiting in Brand Knowledge review. Briefly mention this once; do NOT re-ask the field unless the owner asks to revisit it.`,
      );
    } else if (entry.notice === gapEngine.NOTICES.DRAFT_DIFFERS) {
      noticeLines.push(
        `NOTICE for "${entry.fieldKey}": public research found a value that differs from the approved one (research says: "${evidencePreview(entry.evidence.draftValue)}"). The approved value remains in use. Briefly mention this once; do NOT re-ask the field unless the owner asks to revisit it.`,
      );
    }
  }

  if (!target) {
    const note = [
      "INTERVIEW DIRECTOR (system-generated; not from the user):",
      "All brand-knowledge fields are settled. Continue the normal operational interview (account type, budgets, platforms, working style, etc.). Do not re-ask settled brand fields.",
      ...noticeLines,
    ].join("\n");
    return { note, target: null, noticeFields: noticeLines.length ? plan.filter((e) => e.notice !== "none" && !state.noticesShown[e.fieldKey]).map((e) => e.fieldKey) : [] };
  }

  const lines = [
    "INTERVIEW DIRECTOR (system-generated; not from the user):",
    "Interview action precedence is question selection, not an authority ranking.",
    `Target brand field THIS TURN: "${target.fieldKey}" — action: ${target.action} (reason: ${state.premiseChanged[target.fieldKey] ? gapEngine.REASONS.PREMISE_CHANGED : target.reason}).`,
  ];
  if (target.action === gapEngine.ACTIONS.CONFIRM) {
    const val =
      target.evidence.pendingValue !== undefined
        ? target.evidence.pendingValue
        : target.evidence.draftValue !== undefined
          ? target.evidence.draftValue
          : target.evidence.legacyValue;
    lines.push(
      `Present this UNCONFIRMED candidate value honestly (say where it came from; it is NOT saved as truth until they confirm): "${evidencePreview(val)}". Ask them to confirm it, correct it, or skip it. Set "collects" to "${target.fieldKey}".`,
    );
  } else if (target.action === gapEngine.ACTIONS.ARBITRATE) {
    const cands = (target.evidence.candidates || [])
      .map((c, i) => `${i + 1}) "${evidencePreview(c && c.value)}"`)
      .join("  ");
    lines.push(
      `Two or more UNCONFIRMED candidate values were found: ${cands}. Present them honestly, ask which is right (or for the correct value). Set "collects" to "${target.fieldKey}".`,
    );
  } else {
    lines.push(`Ask for this field conversationally. Set "collects" to "${target.fieldKey}".`);
  }
  lines.push("Ask ONE question. Do not decide precedence or claim anything unconfirmed is saved.");
  lines.push(...noticeLines);
  return {
    note: lines.join("\n"),
    target,
    noticeFields: plan.filter((e) => e.notice !== "none" && !state.noticesShown[e.fieldKey]).map((e) => e.fieldKey),
  };
}

/**
 * Apply an owner's answer for an engine-targeted knowledge field through the
 * canonical boundary. Returns { resolvedKind, premiseChanged } — on a 409
 * stale-base the field is re-presented (premise_changed), never force-written.
 */
async function resolveKnowledgeAnswer({ userId, brandId, draftId, target, answerText, resolution }) {
  const fieldKey = target.fieldKey;
  const kind = resolution && typeof resolution === "object" ? resolution.kind : null;

  // Owner defers: recorded honestly, nothing written, never fabricated.
  if (kind === "defer") return { resolvedKind: "deferred" };

  if (!brandId) {
    // No brand exists yet: the answer stays in session.answers and flows
    // through the existing discovery step (which writes via ownerEditFields).
    return { resolvedKind: "session_only" };
  }

  // Explicit confirmation of a pending revision → canonical approve.
  if (kind === "confirm" && target.evidence && target.evidence.pendingValue !== undefined && resolution.revisionId) {
    try {
      await knowledge.approveRevision({ brandId, userId, revisionId: resolution.revisionId });
      return { resolvedKind: "approved_pending" };
    } catch (err) {
      if (err.statusCode === 409) return { resolvedKind: "premise_changed", message: err.message };
      throw err;
    }
  }

  // Explicit confirmation of a research-draft candidate → adopt (propose with
  // the draft's REAL provenance, server-re-read) then approve. Mirrors
  // brandKnowledgeController.adoptFromDraft's honesty rules.
  if (kind === "confirm" && target.evidence && target.evidence.draftValue !== undefined && draftId) {
    const d = await db.query(
      `SELECT fields FROM sage_research_drafts WHERE draft_id = $1 AND brand_id = $2`,
      [draftId, brandId],
    );
    const f = d.rows.length ? (d.rows[0].fields || {})[fieldKey] : null;
    if (f && f.value !== undefined) {
      const srcKind = Array.isArray(f.sources) && f.sources[0] && f.sources[0].source ? f.sources[0].source : "public_web";
      const proposed = await knowledge.proposeRevision({
        brandId,
        fieldKey,
        proposedValue: f.value,
        provenance: { sources: f.sources || [], confidence: f.confidence || "medium", conflict: f.conflict === true, alternatives: f.alternatives || [] },
        sourceKind: srcKind === "facebook" ? "facebook" : srcKind === "website" ? "website" : "public_web",
        proposedBy: "setup_interview",
        refId: draftId,
      });
      // One-pending dedup: an identical pending proposal already exists —
      // the owner just confirmed that value, so approve the existing one.
      const revisionRow = proposed.duplicate ? proposed.existing : proposed.revision;
      try {
        await knowledge.approveRevision({ brandId, userId, revisionId: revisionRow.revision_id });
        return { resolvedKind: "approved_draft" };
      } catch (err) {
        if (err.statusCode === 409) return { resolvedKind: "premise_changed", message: err.message };
        throw err;
      }
    }
    // Draft row vanished under us — fall through to the stated-value path.
  }

  // Confirmation of a legacy unversioned value, or a typed/spoken owner value
  // (including arbitration picks): the owner STATED it → canonical owner edit.
  const value =
    kind === "confirm"
      ? target.evidence.legacyValue !== undefined
        ? target.evidence.legacyValue
        : answerText
      : resolution && resolution.value !== undefined
        ? resolution.value
        : answerText;
  if (value === null || value === undefined || String(value).trim() === "") {
    return { resolvedKind: "deferred" };
  }
  await knowledge.ownerEditFields({
    brandId,
    userId,
    fields: [{ fieldKey, value: typeof value === "string" ? value.trim() : value }],
    proposedBy: "setup_interview",
  });
  return { resolvedKind: "owner_stated" };
}

// ---------------------------------------------------------------------------
// Session serialization
// ---------------------------------------------------------------------------

function isTerminalSetupJourney(session) {
  if (!session || session.status !== "completed") return false;
  const completed = new Set(
    Array.isArray(session.completed_steps) ? session.completed_steps : [],
  );
  const outcomes =
    session.answers &&
    typeof session.answers === "object" &&
    session.answers.step_outcomes &&
    typeof session.answers.step_outcomes === "object"
      ? session.answers.step_outcomes
      : {};
  return ACTIONS.every((action) => {
    if (!completed.has(action.key)) return false;
    const outcome = outcomes[action.key];
    return (
      outcome === "completed" ||
      outcome === "skipped" ||
      isValidOwnerDirectedDeferral(outcome)
    );
  });
}

function serializeSession(session) {
  const answers = session.answers || {};
  return {
    sessionId: session.session_id,
    status: session.status,
    answers,
    completedSteps: session.completed_steps || [],
    // 026-C1: per-step truthful outcomes ('completed' | 'skipped') so a reload
    // renders "Skipped." for skipped steps instead of a lying "Done.".
    stepOutcomes:
      answers.step_outcomes && typeof answers.step_outcomes === "object"
        ? answers.step_outcomes
        : {},
    currentField: session.current_field,
    interviewComplete: session.interview_complete,
    consentGranted: session.consent_granted,
    brandId: session.brand_id,
    steps: actionMeta(),
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/setup-agent/session
 * Resumes the caller's active session if one exists; otherwise starts a fresh one
 * and returns the agent's first question.
 */
async function initiateSession(req, res) {
  const userId = req.user.userId;
  // Prompt 035 Section H — narrow second-business entry. intent is optional:
  // absent/anything-else preserves today's behavior bit-for-bit. Only the
  // explicit "new_business" intent changes the path: the fresh session must
  // NOT resume an open session, must NOT bind the inventory's brand, and
  // create_brand_profile must NOT crash-recover a prior discovery brand.
  const intent = req.body && req.body.intent === "new_business" ? "new_business" : null;
  try {
    const journey = await db.query(
      `SELECT u.onboarding_completed,
              (SELECT COUNT(*)::int
                 FROM setup_sessions s
                WHERE s.user_id = u.user_id AND s.status = 'completed') AS completed_journey_count
         FROM users u
        WHERE u.user_id = $1`,
      [userId],
    );
    if (journey.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const onboardingCompleted = journey.rows[0].onboarding_completed === true;
    const completedJourneyCount = Number(journey.rows[0].completed_journey_count || 0);
    if (!onboardingCompleted && intent === "new_business") {
      return res.status(409).json({
        error: "Finish your initial setup before starting a different business.",
        code: "onboarding_incomplete_new_business",
      });
    }
    if (!onboardingCompleted && completedJourneyCount > 0) {
      return res.status(409).json({
        error: "Your completed setup journey must finish Guided Setup before another session can start.",
        code: "setup_journey_completed",
        completedSessionCount: completedJourneyCount,
      });
    }
    const existing = await db.query(
      `SELECT * FROM setup_sessions
       WHERE user_id = $1 AND status IN ('in_progress', 'paused')
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    // Read-only probe (Section H): lets the client decide whether to show the
    // second-business entry choice WITHOUT creating or resuming anything. An
    // open session means "resume in progress — don't interrupt with a choice".
    if (req.body && req.body.probe === true) {
      return res.json({ openSession: existing.rows.length > 0 });
    }
    if (intent === "new_business" && existing.rows.length > 0) {
      // The open session belongs to the previous business. Pause it (never
      // delete — the owner can resume it later) so the new-business session
      // becomes the active one.
      await db.query(
        `UPDATE setup_sessions SET status = 'paused', paused_at = NOW(), updated_at = NOW()
          WHERE user_id = $1 AND status = 'in_progress'`,
        [userId],
      );
      existing.rows.length = 0;
    }
    if (existing.rows.length > 0) {
      // Resuming an existing run: stamp resumed_at and clear any paused state so
      // the lifecycle (started/paused/resumed) reflects reality.
      const resumed = await db.query(
        `UPDATE setup_sessions
           SET status = 'in_progress', resumed_at = NOW(), updated_at = NOW()
         WHERE session_id = $1
         RETURNING *`,
        [existing.rows[0].session_id],
      );
      let session = resumed.rows[0];
      // 026-C3-PM5 §5: completed_steps is operational runner state, not
      // launch evidence — reconcile it against authoritative launch evidence
      // on every resume. Idempotent; preserves all historical evidence.
      session = await reconcileCompletedSteps(session);
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      let firstQuestion = null;
      if (lastAssistant) {
        try {
          firstQuestion = JSON.parse(lastAssistant.content);
        } catch (err) {
          firstQuestion = null;
        }
      }
      // P035-C2 — a pending volunteered-URL confirmation survives refresh/
      // resume: re-emit the SAME truthful confirmation (never the engine
      // question, never a duplicate capture; catalog state stays intact).
      const resumeState = interviewState(
        session.answers && typeof session.answers === "object" ? session.answers : {},
      );
      if (!session.interview_complete && resumeState.urlConfirm.queue.length > 0) {
        const head = resumeState.urlConfirm.queue[0];
        firstQuestion = c2Question(head, { reask: head.reasked === true });
      }
      return res.json({
        session: serializeSession(session),
        question: firstQuestion,
        resumed: true,
      });
    }

    // New session — assemble the four-state knowledge projection so the very
    // first turn is already gap-driven (Prompt 023). The interview always
    // still OPENS with account type (that shapes everything downstream); the
    // engine's plan takes over question selection for brand fields after.
    // Prompt 035 Section H: a new-business session must not inherit the
    // existing brand's knowledge inventory or brand binding — it starts in
    // sparse mode exactly like a brand-new user (every field honestly
    // "missing"), so the gap engine can't skip questions already answered
    // for the OTHER business.
    const inv =
      intent === "new_business"
        ? { brandId: null, draftId: null, inventory: { approved: {}, pending: {}, legacy: {}, draft: {} } }
        : await loadInterviewInventory(userId, null);
    const state = interviewState({});
    if (intent === "new_business") state.entryIntent = "new_business";
    if (inv.readFailure) state.knowledgeReadFailed = true;
    const plan = inv.inventory ? gapEngine.buildPlan(inv.inventory) : null;

    const kickoff = [
      { role: "user", content: "Please begin the setup interview with your first question." },
    ];
    if (plan) {
      const skips = plan.filter((e) => e.action === gapEngine.ACTIONS.SKIP).map((e) => e.fieldKey);
      if (skips.length) {
        kickoff.push({
          role: "user",
          content: `INTERVIEW DIRECTOR (system-generated; not from the user):\nInterview action precedence is question selection, not an authority ranking.\nThese brand fields already have APPROVED owner-reviewed values — do NOT re-ask them: ${skips.join(", ")}. Still open by asking what they are setting up (account type).`,
        });
      }
    }
    const decision = await askInterview(kickoff, { userId, brandId: inv.brandId || null });
    const messages = kickoff.concat([{ role: "assistant", content: JSON.stringify(decision) }]);

    const answers = { _interview: state };
    const inserted = await db.query(
      `INSERT INTO setup_sessions (user_id, messages, answers, current_field, interview_complete, brand_id)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        JSON.stringify(messages),
        JSON.stringify(answers),
        decision.collects || null,
        false, // completion is engine-decided; the AI's boolean is advisory
        inv.brandId || null,
      ],
    );
    const session = inserted.rows[0];
    return res.json({ session: serializeSession(session), question: decision, resumed: false });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Setup agent initiate error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to start the setup agent" });
  }
}

// ---------------------------------------------------------------------------
// P035-C2 — volunteered-URL confirmation (deterministic; detection ≠ capture)
// ---------------------------------------------------------------------------

// Non-catalog sentinel target for the confirmation turn. Deliberately OUTSIDE
// the knowledge catalog: it is never a knowledge FIELD_KEY, never creates a
// knowledge version, never resolves through the knowledge-field write path.
const C2_URL_CONFIRM_SENTINEL = "_c2_url_confirm";
const C2_QUEUE_CAP = 3;
const C2_LOG_MAX = 20;
// Conservative, word-bounded lexicons; anything else is ambiguous (re-ask
// once, then fail closed). "not…" never matches the NO stem "no\b".
const C2_YES_RE = /^\s*(yes|yeah|yep|yup|correct|exactly|affirmative|that'?s (right|it|correct|the one)|it is|sure( is)?)\b/i;
const C2_NO_RE = /^\s*(no|nope|nah|negative|wrong|that'?s not|it'?s not|isn'?t)\b/i;

function c2Question(cand, { reask = false } = {}) {
  const noun = cand.kind === "facebook" ? "Facebook page" : "business website";
  return {
    message: reask
      ? `Just to be sure — is ${cand.value} your ${noun}? Please answer yes or no.`
      : `I noticed ${cand.value} in your answer. Is that your ${noun}?`,
    collects: C2_URL_CONFIRM_SENTINEL,
    complete: false,
    action: "confirm",
    targetField: C2_URL_CONFIRM_SENTINEL,
    candidate: { value: cand.value, origin: "volunteered_url" },
  };
}

// AM-3 — bounded confirmation-exchange record: what the owner actually said
// during a consumed confirmation turn is preserved, never reinterpreted.
function c2LogPush(uc, role, text) {
  // C2-PM1(b) — fail-honest bounds: caps stay (20 entries / 500 chars) but
  // the record must REVEAL what the caps cut. Truncated entries carry a
  // marker + the original length; entries dropped by the 20-entry cap are
  // counted in uc.logDroppedCount. Nothing routes elsewhere, nothing infers.
  const full = String(text);
  const entry = { role, text: full.slice(0, 500), at: new Date().toISOString() };
  if (full.length > 500) {
    entry.truncated = true;
    entry.originalLength = full.length;
  }
  uc.exchangeLog.push(entry);
  if (uc.exchangeLog.length > C2_LOG_MAX) {
    const dropped = uc.exchangeLog.length - C2_LOG_MAX;
    uc.exchangeLog.splice(0, dropped);
    uc.logDroppedCount = (typeof uc.logDroppedCount === "number" ? uc.logDroppedCount : 0) + dropped;
  }
}

// YES path — the confirmed candidate enters the SAME alias the whole-answer
// path uses, then the SAME accepted chain (applyOnlinePresence →
// onAnchorArrival reason "setup_interview"). No second pipeline. Wording is
// honest: "saved" only once the anchor is actually structured; with no brand
// yet, the existing later applyOnlinePresence pickup path processes it.
async function c2CaptureConfirmed(userId, session, answers, cand) {
  const noun = cand.kind === "facebook" ? "Facebook page" : "website";
  if (cand.kind === "facebook") answers.facebook_page = cand.value;
  else answers.business_website = cand.value;
  if (!session.brand_id) {
    return `Thanks — I've noted ${cand.value} as your ${noun}; I'll attach it to your business profile as soon as it's created.`;
  }
  try {
    const changed = await applyOnlinePresence(userId, session.brand_id, answers);
    if (changed) {
      anchorOrchestrator.onAnchorArrival({
        userId,
        brandId: session.brand_id,
        reason: "setup_interview",
      });
    }
    return `Got it — I've saved ${cand.value} as your ${noun}.`;
  } catch (err) {
    console.error("P035-C2 confirmed-URL capture failed (interview continues):", err.message);
    return `Thanks — I've noted ${cand.value} as your ${noun}; I'll finish attaching it shortly.`;
  }
}

/**
 * POST /api/setup-agent/answer  { sessionId, answer }
 * Records the answer, asks the AI for the next question (or completion), and
 * returns it.
 */
async function submitAnswer(req, res) {
  const userId = req.user.userId;
  const { sessionId, answer } = req.body;
  if (!sessionId || typeof answer !== "string" || answer.trim() === "") {
    return res.status(400).json({ error: "sessionId and a non-empty answer are required" });
  }

  try {
    const result = await db.query(
      "SELECT * FROM setup_sessions WHERE session_id = $1 AND user_id = $2",
      [sessionId, userId],
    );
    const session = result.rows[0];
    if (!session) return res.status(404).json({ error: "Setup session not found" });
    if (session.status === "completed" || session.status === "dismissed") {
      return res.status(409).json({ error: "This setup session is already finished" });
    }
    if (session.interview_complete) {
      return res.status(409).json({ error: "The interview is already complete" });
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const answers = session.answers && typeof session.answers === "object" ? session.answers : {};
    const state = interviewState(answers);
    const resolution =
      req.body && req.body.resolution && typeof req.body.resolution === "object"
        ? req.body.resolution
        : null;
    const continueRequested = req.body && req.body.continueAnyway === true;

    // P035-C2 — intercept-first confirmation turn. While a volunteered URL
    // awaits confirmation, this turn is handled DETERMINISTICALLY before the
    // engine/AI path: the reply is a confirmation answer, NOT the pending
    // catalog field's answer (current_field, messages, surfaces untouched).
    const uc = state.urlConfirm;
    if (uc.queue.length > 0) {
      const cand = uc.queue[0];
      const reply = answer.trim();
      c2LogPush(uc, "owner", reply);
      // K — a corrected literal URL wins over yes/no wording: the original is
      // rejected and the corrected URL must ITSELF be confirmed (never
      // silently captured). The candidate's own URL echoed back is not a
      // correction.
      const corrected = extractUrlCandidates(reply).candidates.filter(
        (c) => c.value !== cand.value && !uc.decided[c.value] && !uc.queue.some((q) => q.value === c.value),
      );
      let ack = null;
      if (corrected.length > 0) {
        uc.decided[cand.value] = "rejected";
        uc.queue.shift();
        for (const c of corrected.reverse()) {
          if (uc.queue.length < C2_QUEUE_CAP) uc.queue.unshift(c);
        }
      } else if (C2_YES_RE.test(reply)) {
        uc.decided[cand.value] = "confirmed";
        uc.queue.shift();
        ack = await c2CaptureConfirmed(userId, session, answers, cand);
      } else if (C2_NO_RE.test(reply)) {
        uc.decided[cand.value] = "rejected";
        uc.queue.shift();
        ack = `No problem — I won't use ${cand.value}.`;
      } else if (cand.reasked === true) {
        // L — second ambiguous reply: fail closed. Rejected, nothing
        // captured, no research; the interview resumes.
        uc.decided[cand.value] = "rejected";
        uc.queue.shift();
        ack = `Okay — I'll set ${cand.value} aside for now.`;
      } else {
        cand.reasked = true; // re-ask ONCE with explicit yes/no framing
      }
      let questionOut;
      if (uc.queue.length > 0) {
        questionOut = c2Question(uc.queue[0], { reask: uc.queue[0].reasked === true });
        if (ack) questionOut.message = `${ack} ${questionOut.message}`;
      } else {
        // Queue drained — resume by re-presenting the pending engine question
        // VERBATIM from messages (current_field and catalog state unchanged).
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        let pendingQ = null;
        if (lastAssistant) {
          try {
            pendingQ = JSON.parse(lastAssistant.content);
          } catch {
            pendingQ = null;
          }
        }
        questionOut = { ...(pendingQ || {}), complete: false };
        questionOut.message =
          pendingQ && pendingQ.message
            ? `${ack ? `${ack} ` : ""}Back to where we were: ${pendingQ.message}`
            : ack || "Let's continue.";
        if (session.current_field) questionOut.collects = session.current_field;
      }
      c2LogPush(uc, "echo", questionOut.message);
      answers._interview = state;
      const updatedC2 = await db.query(
        `UPDATE setup_sessions SET answers = $1::jsonb, updated_at = NOW()
          WHERE session_id = $2 RETURNING *`,
        [JSON.stringify(answers), sessionId],
      );
      return res.json({ session: serializeSession(updatedC2.rows[0]), question: questionOut });
    }

    if (session.current_field) {
      answers[session.current_field] = answer.trim();
    } else {
      answers[`answer_${Object.keys(answers).length + 1}`] = answer.trim();
    }

    // Re-read the knowledge projection IMMEDIATELY before acting on the answer
    // (D-36 A3) — approvals/edits made elsewhere mid-interview change premises.
    // Prompt 035 Section H: a new-business session with no brand yet must stay
    // in sparse mode — resolveInterviewBrand's single-brand fallback would
    // otherwise silently bind the OTHER business's brand and knowledge.
    const inv =
      state.entryIntent === "new_business" && !session.brand_id
        ? { brandId: null, draftId: null, inventory: { approved: {}, pending: {}, legacy: {}, draft: {} } }
        : await loadInterviewInventory(userId, session.brand_id);
    if (inv.readFailure) state.knowledgeReadFailed = true;
    const plan = !inv.readFailure && inv.inventory ? gapEngine.buildPlan(inv.inventory) : null;

    let premiseNote = null;
    const answeredField = session.current_field;
    const planEntry =
      plan && answeredField ? plan.find((e) => e.fieldKey === answeredField) || null : null;

    let resolvedKind = null;
    if (planEntry && planEntry.action !== gapEngine.ACTIONS.SKIP) {
      // Engine-targeted knowledge field: resolve through the canonical boundary.
      const result = await resolveKnowledgeAnswer({
        userId,
        brandId: inv.brandId || session.brand_id || null,
        draftId: inv.draftId || null,
        target: planEntry,
        answerText: answer.trim(),
        resolution,
      });
      resolvedKind = result.resolvedKind;
      if (result.resolvedKind === "premise_changed") {
        // Stale base (409): never force-written. Re-present the field once
        // with the changed premise acknowledged honestly.
        state.premiseChanged[answeredField] = true;
        premiseNote = `The stored value for "${answeredField}" changed while we were talking (${result.message || "it was updated elsewhere"}). Re-present this field against its CURRENT state; do not assume the earlier premise.`;
      } else if (result.resolvedKind === "deferred") {
        state.deferred[answeredField] = true;
      } else {
        state.resolved[answeredField] = true;
      }
    } else if (planEntry == null && answeredField && plan) {
      // Operational (non-knowledge) field — nothing to write here.
    }

    // P035-C1 — verbatim URL answers are identity anchors wherever they land
    // in the conversation (the engine has no website/facebook slot, so the
    // owner supplies them as free answers). STRICT whole-answer detection
    // through the existing deterministic normalizers only — never text
    // mining inside prose. The raw answer is stored under the canonical
    // presence alias key in session.answers (JSONB — no schema), which is
    // exactly what applyOnlinePresence already reads, both mid-interview and
    // at execution time.
    {
      const rawAnswer = answer.trim();
      const wholeAnswerUrl = /^(https?:\/\/)?[\w][\w.-]*\.[a-z]{2,}([/?#]\S*)?$/i.test(rawAnswer);
      if (wholeAnswerUrl) {
        const fb = normalizeFacebookPageUrl(rawAnswer);
        if (fb.ok && fb.value) {
          answers.facebook_page = rawAnswer;
        } else {
          const site = normalizeWebsiteUrl(rawAnswer);
          if (site.ok && site.value) answers.business_website = rawAnswer;
        }
      } else {
        // P035-C2 — embedded literal URL candidates. Detection is NEVER
        // capture: candidates only QUEUE for explicit owner confirmation.
        // The whole-answer path above wins first and stays unchanged; a
        // previously decided URL never re-prompts (idempotency); a URL whose
        // normalized value is already the captured alias never re-prompts.
        // Beyond-cap candidates are counted for honest disclosure and are
        // NEVER entered into decided (AM-1 — re-volunteering stays eligible).
        const { candidates, overflow } = extractUrlCandidates(rawAnswer);
        let dropped = overflow;
        for (const cand of candidates) {
          if (uc.decided[cand.value]) continue;
          if (uc.queue.some((q) => q.value === cand.value)) continue;
          const existing = cand.kind === "facebook" ? answers.facebook_page : answers.business_website;
          if (existing) {
            const norm =
              cand.kind === "facebook"
                ? normalizeFacebookPageUrl(existing)
                : normalizeWebsiteUrl(existing);
            if (norm.ok && norm.value === cand.value) continue;
          }
          if (uc.queue.length >= C2_QUEUE_CAP) {
            dropped += 1;
            continue;
          }
          uc.queue.push({ value: cand.value, kind: cand.kind });
        }
        if (dropped > 0) uc.pendingOverflow += dropped;
      }
    }

    // P035-C1 — early brand creation at the business-name confirmation
    // boundary. Fires ONLY when: the ENGINE targeted business_name this turn
    // (never arbitrary utterances), the owner's answer RESOLVED it
    // (stated/confirmed — deferrals, refusals and premise changes never
    // create), it resolved as session_only (no brand is bound anywhere; a
    // resolution against an existing bound brand must never spawn a second
    // brand), and the session has no brand. With no plan (knowledge read
    // failure) creation fails closed to the accepted end-of-interview path.
    let brandJustCreated = false;
    if (
      !session.brand_id &&
      answeredField === "business_name" &&
      resolvedKind === "session_only" &&
      state.resolved.business_name === true &&
      !isRefusalAnswer(answer.trim())
    ) {
      const statedName =
        resolution && resolution.value !== undefined && String(resolution.value).trim()
          ? String(resolution.value).trim()
          : answer.trim();
      const createdId = await ensureInterviewBrand(userId, session, statedName);
      brandJustCreated = Boolean(createdId);
    }

    // P035-C1 — mid-interview anchor handoff. Once the onboarding brand
    // exists, every later verbatim fact and identity anchor collected in this
    // SAME conversation persists to the brand through the accepted Prompt-035
    // paths immediately (both helpers are idempotent — unchanged values are
    // skipped), and the existing anchor machinery fires so Tier-A research
    // proceeds WHILE the owner keeps talking. Best-effort: instrumentation of
    // the brand must never break the interview turn.
    if (session.brand_id) {
      let presenceChanged = false;
      try {
        presenceChanged = await applyOnlinePresence(userId, session.brand_id, answers);
        await applyStatedFacts(userId, session.brand_id, answers);
      } catch (err) {
        console.error("P035-C1 mid-interview handoff failed (interview continues):", err.message);
      }
      if (brandJustCreated || presenceChanged) {
        anchorOrchestrator.onAnchorArrival({
          userId,
          brandId: session.brand_id,
          reason: "setup_interview",
        });
      }
    }

    // Owner chose to continue onboarding with open gaps: honest exit — the
    // remaining gaps are recorded as deferred_by_owner, never fabricated.
    if (continueRequested && plan) {
      const exit = gapEngine.continueAnyway(plan, state);
      for (const d of exit.deferred) state.deferred[d.fieldKey] = true;
      state.continueAnyway = true;
    }

    messages.push({ role: "user", content: answer.trim() });

    // Engine-directed next turn (question selection, not authority ranking).
    let director = null;
    if (plan) {
      director = buildDirectorNote(plan, state);
      // P035-C2 honesty (Section P): the AI must never claim a link was
      // received/saved unless it is actually present in the structured
      // setup answers — a link merely mentioned in prose is NOT captured.
      director.note +=
        "\nNever claim a website or Facebook link was received, saved, or added to the business profile unless it is already present in the structured setup answers (business_website / facebook_page). A link merely mentioned in conversation is NOT captured.";
      if (premiseNote) director.note += `\n${premiseNote}`;
      messages.push({ role: "user", content: director.note });
      if (director.target) {
        state.surfaces[director.target.fieldKey] =
          (state.surfaces[director.target.fieldKey] || 0) + 1;
      }
      for (const fk of director.noticeFields || []) state.noticesShown[fk] = true;
    }

    const decision = await askInterview(messages, {
      userId,
      brandId: inv.brandId || session.brand_id || null,
    });
    // The engine selected the field; the AI only phrased it. Enforce collects.
    if (director && director.target) decision.collects = director.target.fieldKey;
    messages.push({ role: "assistant", content: JSON.stringify(decision) });

    // Completion is ENGINE-decided (D-36 A6): the AI's `complete` boolean is
    // advisory — it may influence conversational wrap-up wording only, never
    // completion state in either direction. With a plan: complete exactly when
    // the engine is settled (continue-anyway is one way the engine reaches
    // settled, via deferral). Without a plan (knowledge read failed / no
    // brand): legacy AI signal.
    const engineSettled = plan ? gapEngine.interviewComplete(plan, state) : true;
    const complete = plan
      ? engineSettled
      : decision.complete || state.continueAnyway;
    decision.complete = complete;

    if (complete) {
      // Interview finished — persist the owner's working-style preferences
      // (involvement mode, briefing, alerts, detail level) so every Echo
      // surface can honor them. Best-effort: a save failure never blocks setup.
      await echoContext.saveWorkingStyle(userId, extractWorkingStyle(answers)).catch(() => {});
    }

    answers._interview = state;
    const updated = await db.query(
      `UPDATE setup_sessions
         SET messages = $1::jsonb, answers = $2::jsonb, current_field = $3,
             interview_complete = $4, updated_at = NOW()
       WHERE session_id = $5
       RETURNING *`,
      [
        JSON.stringify(messages),
        JSON.stringify(answers),
        complete ? null : decision.collects || null,
        complete,
        sessionId,
      ],
    );

    // Surface the engine's decision context so the client can render honest
    // confirm/arbitrate affordances (buttons) instead of guessing from text.
    const questionOut = { ...decision };
    if (!complete && director && director.target) {
      const t = director.target;
      questionOut.targetField = t.fieldKey;
      questionOut.action = t.action;
      questionOut.reason = state.premiseChanged[t.fieldKey] ? gapEngine.REASONS.PREMISE_CHANGED : t.reason;
      if (t.action === gapEngine.ACTIONS.CONFIRM) {
        questionOut.candidate =
          t.evidence.pendingValue !== undefined
            ? { value: t.evidence.pendingValue, origin: "pending_revision", revisionId: (inv.inventory.pending[t.fieldKey] || {}).revisionId }
            : t.evidence.draftValue !== undefined
              ? { value: t.evidence.draftValue, origin: "research_draft" }
              : { value: t.evidence.legacyValue, origin: "legacy_unreviewed" };
      }
      if (t.action === gapEngine.ACTIONS.ARBITRATE) {
        questionOut.candidates = (t.evidence.candidates || []).map((c) => ({
          value: c.value,
          origin: c.origin,
          revisionId: c.origin === "pending_revision" ? (inv.inventory.pending[t.fieldKey] || {}).revisionId : undefined,
        }));
      }
    }

    // P035-C2 — a freshly queued volunteered-URL candidate overrides this
    // turn's OUTGOING question with the server-templated confirmation (the
    // AI's phrasing never reaches the owner on the detection turn, so a
    // premature "thanks for sharing the website!" is impossible). The engine
    // question stays in messages/current_field and is re-presented verbatim
    // once the confirmation resolves. On a same-turn completion the interview
    // is never held hostage: honest disclosure only, nothing captured, and
    // the undecided URLs stay eligible for later re-volunteering (AM-1).
    if (uc.queue.length > 0) {
      if (complete) {
        const links = uc.queue.map((q) => q.value).join(", ");
        uc.queue = [];
        uc.pendingOverflow = 0;
        questionOut.message = `${questionOut.message} One more note: I noticed ${links} in your answers but haven't saved anything — you can add links to your business profile anytime.`;
        answers._interview = state;
        await db.query(
          `UPDATE setup_sessions SET answers = $1::jsonb, updated_at = NOW() WHERE session_id = $2`,
          [JSON.stringify(answers), sessionId],
        );
      } else {
        const confirmQ = c2Question(uc.queue[0]);
        const extra = uc.pendingOverflow;
        if (extra > 0) {
          confirmQ.message += ` I also spotted ${extra} more link${extra === 1 ? "" : "s"} I haven't queued — re-paste any one you want me to handle.`;
          uc.pendingOverflow = 0;
        }
        c2LogPush(uc, "echo", confirmQ.message);
        answers._interview = state;
        const reUpdated = await db.query(
          `UPDATE setup_sessions SET answers = $1::jsonb, updated_at = NOW()
            WHERE session_id = $2 RETURNING *`,
          [JSON.stringify(answers), sessionId],
        );
        return res.json({ session: serializeSession(reUpdated.rows[0]), question: confirmQ });
      }
    }

    return res.json({ session: serializeSession(updated.rows[0]), question: questionOut });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Setup agent answer error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to process your answer" });
  }
}

/**
 * POST /api/setup-agent/consent  { sessionId }
 * Records the explicit in-app consent required before any setup action runs.
 */
async function grantConsent(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    const result = await db.query(
      `UPDATE setup_sessions
         SET consent_granted = TRUE, consent_at = NOW(), updated_at = NOW()
       WHERE session_id = $1 AND user_id = $2
         AND status NOT IN ('completed', 'dismissed')
       RETURNING *`,
      [sessionId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Active setup session not found" });
    }
    return res.json({ session: serializeSession(result.rows[0]) });
  } catch (err) {
    console.error("Setup agent consent error:", err.message);
    return res.status(500).json({ error: "Failed to record consent" });
  }
}

// ---------------------------------------------------------------------------
// Concurrency: renewable execution lease
// ---------------------------------------------------------------------------
// The /execute endpoint runs one setup action per call. Only one call may run a
// step for a given session at a time. We use a compare-and-swap "executing" claim
// backed by a renewable lease: while a step runs the lease is heartbeated, so a
// legitimately slow step (e.g. an unusually slow AI/provider call that exceeds the
// lease window) is never reclaimed out from under it. Only a truly dead claim —
// one whose lease expired with no heartbeat, i.e. a crashed process — becomes
// reclaimable, so a session can never deadlock permanently either.

// A held claim whose executing_at is older than this (no heartbeat) is dead and
// reclaimable. The heartbeat interval must be comfortably smaller than this.
const EXECUTION_LEASE_SECONDS = 300;
const EXECUTION_HEARTBEAT_MS = 60 * 1000;

// Atomically claim the execution slot. Returns a per-claim fencing token if the
// caller now holds the lease, or null if another live lease blocks it. The token
// must be presented to heartbeat/release so only the current owner can affect it.
async function claimExecution(sessionId) {
  const token = crypto.randomUUID();
  const claim = await db.query(
    `UPDATE setup_sessions SET executing = TRUE, executing_at = NOW(), executing_token = $3
       WHERE session_id = $1
         AND (executing = FALSE OR executing_at < NOW() - ($2 || ' seconds')::interval)
       RETURNING session_id`,
    [sessionId, String(EXECUTION_LEASE_SECONDS), token],
  );
  return claim.rows.length > 0 ? token : null;
}

// Refresh the lease we currently hold. Guarded on the fencing token so it can only
// refresh the lease this caller owns — never a released or reclaimed one.
async function heartbeatExecution(sessionId, token) {
  await db.query(
    "UPDATE setup_sessions SET executing_at = NOW() WHERE session_id = $1 AND executing = TRUE AND executing_token = $2",
    [sessionId, token],
  );
}

// Start heartbeating the lease on an interval. Returns the timer to clear on release.
function startHeartbeat(sessionId, token) {
  const timer = setInterval(() => {
    heartbeatExecution(sessionId, token).catch(() => {});
  }, EXECUTION_HEARTBEAT_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

// Release the execution slot so the next /execute call can proceed. Token-guarded:
// a revived crashed executor whose lease was already reclaimed can never clear the
// new owner's live lease. Best-effort.
async function releaseExecution(sessionId, token) {
  await db
    .query(
      "UPDATE setup_sessions SET executing = FALSE, executing_at = NULL, executing_token = NULL WHERE session_id = $1 AND executing_token = $2",
      [sessionId, token],
    )
    .catch(() => {});
}

// Pure tier-gate decision for a setup action: admins bypass, baseline actions
// (no `feature`) are always allowed, otherwise the user's tier must meet the
// feature's required tier. Extracted so it is unit-testable without a DB.
function isActionAllowed(action, tier, role) {
  if (role === "admin") return true;
  if (!action.feature) return true;
  const feat = FEATURES[action.feature];
  if (!feat) return false; // fail closed: an unknown feature key never unlocks a gated action
  return meetsTier(tier, feat.tier);
}

/**
 * POST /api/setup-agent/execute  { sessionId, skip? }
 * Runs the NEXT pending setup action (consent-gated). Called repeatedly by the UI
 * until allComplete. `skip: true` marks the current pending action as skipped
 * (used to move past an optional OAuth handoff).
 */
async function executeNextAction(req, res) {
  const userId = req.user.userId;
  const session = req.setupSession; // attached by requireSetupConsent
  const skip = req.body && req.body.skip === true;
  // 026-C1: an artifact-bound confirmation for a paused consent gate (e.g.
  // { step: 'social_schedule', digest }). Passed through to the step's run().
  const confirm =
    req.body && req.body.confirm && typeof req.body.confirm === "object" ? req.body.confirm : null;

  // Claim the renewable execution lease (see helpers above). If another call holds
  // a live lease, refuse with 409; the client retries. The heartbeat keeps a slow
  // step's lease fresh so it is never reclaimed while genuinely running.
  const leaseToken = await claimExecution(session.session_id);
  if (!leaseToken) {
    // 026-C2: the refusal now carries the authoritative serialized session so
    // the client can reconcile (adopt server truth, then bounded re-attempt)
    // instead of rendering a terminal "Please wait" over a dead loop. The
    // session in this body is the row as of this request — status
    // 'in_progress' distinguishes a live lease conflict from the
    // pause/dismiss races respondCancelledMidStep reports.
    const current = await reloadSession(session.session_id);
    return res.status(409).json({
      error: "A setup step is already running.",
      code: "execute_in_progress",
      session: current ? serializeSession(current) : undefined,
    });
  }
  const heartbeat = startHeartbeat(session.session_id, leaseToken);

  try {
    if (!session.interview_complete) {
      return res.status(409).json({ error: "Finish the interview before configuring your account" });
    }

    const completed = Array.isArray(session.completed_steps) ? session.completed_steps : [];
    const answers = session.answers && typeof session.answers === "object" ? session.answers : {};
    const nextAction = ACTIONS.find((a) => !completed.includes(a.key));

    if (!nextAction) {
      // Everything done — finalize and auto-revoke consent. Guarded on
      // status = 'in_progress' so a pause/dismiss that committed while this step
      // ran can never be resurrected back to 'completed' (the "dismissed → later
      // completed" flip). If the guard matched nothing, the session was cancelled
      // mid-flight; report its real state instead of a bogus completion.
      const finalized = await db.query(
        `UPDATE setup_sessions
           SET status = 'completed', consent_granted = FALSE, completed_at = NOW(), updated_at = NOW()
         WHERE session_id = $1 AND status = 'in_progress'
         RETURNING *`,
        [session.session_id],
      );
      if (finalized.rows.length === 0) {
        return respondCancelledMidStep(res, session.session_id);
      }
      return res.json({
        allComplete: true,
        session: serializeSession(finalized.rows[0]),
      });
    }

    // Explicit skip of the current pending action (e.g. user declines an OAuth handoff).
    if (skip) {
      const existingOutcome =
        answers.step_outcomes &&
        typeof answers.step_outcomes === "object" &&
        answers.step_outcomes[nextAction.key];
      const deferredOutcome = isDeferrableFailedOutcome(nextAction.key, existingOutcome)
        ? enrichOwnerDirectedDeferral(existingOutcome)
        : null;
      if (deferredOutcome) {
        completed.push(nextAction.key);
        const updatedRow = await writeCompletedSteps(session.session_id, completed, {
          key: nextAction.key,
          outcome: deferredOutcome,
        });
        if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
        const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
        return res.json({
          allComplete: false,
          step: { key: nextAction.key, label: nextAction.label },
          status: "deferred",
          detail:
            "Deferred — your campaign draft stays paused at Meta and is not running. Setup will continue without it; you can resolve it later.",
          remaining,
          session: serializeSession(updatedRow),
        });
      }
      completed.push(nextAction.key);
      const updatedRow = await writeCompletedSteps(session.session_id, completed, {
        key: nextAction.key,
        outcome: "skipped",
      });
      if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
      const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
      return res.json({
        allComplete: false,
        step: { key: nextAction.key, label: nextAction.label },
        status: "skipped",
        detail: "Skipped.",
        remaining,
        session: serializeSession(updatedRow),
      });
    }

    // Tier gate: skip gated actions gracefully for lower tiers (admins bypass).
    if (nextAction.feature) {
      const { tier, role } = await getUserTier(userId);
      const allowed = isActionAllowed(nextAction, tier, role);
      if (!allowed) {
        completed.push(nextAction.key);
        const updatedRow = await writeCompletedSteps(session.session_id, completed, {
          key: nextAction.key,
          outcome: "skipped",
        });
        if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
        const feat = FEATURES[nextAction.feature] || { name: nextAction.label, tier: "a higher" };
        const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
        return res.json({
          allComplete: false,
          step: { key: nextAction.key, label: nextAction.label },
          status: "skipped",
          detail: `Skipped — needs the ${feat.name} feature (${feat.tier} plan).`,
          remaining,
          session: serializeSession(updatedRow),
        });
      }
    }

    // Run the action. A fresh copy of the session row is passed so create_brand_profile
    // can persist and reuse brand_id within the run.
    const liveSession = await reloadSession(session.session_id);
    let outcome;
    try {
      outcome = await nextAction.run({ userId, session: liveSession, answers, confirm });
    } catch (stepErr) {
      // 026-C2: a thrown setup step is a FAILURE, recorded durably and
      // owner-safely — never a console-only log (the SDS-H1 silent freeze),
      // never coerced to a truthful-looking "skipped", and never added to
      // completed_steps. The step stays the current runnable step so Retry
      // re-runs exactly it (each step's own idempotency precheck guards
      // against duplicate side effects).
      const { code, retryable, safeMessage } = classifyStepError(stepErr);
      const ref = crypto.randomUUID();
      // Raw provider/SDK text goes to the SERVER LOG ONLY, tied to the
      // browser-visible record by the opaque ref (AM-C2-1).
      console.error(
        `Setup agent step "${nextAction.key}" failed [${code}] [ref ${ref}]:`,
        stepErr.message,
      );
      const outcome = {
        status: "failed",
        at: new Date().toISOString(),
        code,
        // 026-C3 (I-61): only explicitly authored marker text (safeMessage,
        // set at trusted throw sites) may replace the bounded template —
        // err.message is never generically exposed (AM-C2-1 preserved).
        message:
          (code === "owner_action_required" && safeMessage) ||
          STEP_FAILURE_TEMPLATES[code] ||
          STEP_FAILURE_TEMPLATES.internal_error,
        retryable,
        ref,
      };
      const failedRow = await writeFailedOutcome(session.session_id, nextAction.key, outcome);
      if (!failedRow) return respondCancelledMidStep(res, session.session_id);
      return res.status(retryable ? 502 : 400).json({
        error: outcome.message,
        failedStep: { key: nextAction.key, label: nextAction.label },
        outcome: { code, retryable, ref, at: outcome.at },
        session: serializeSession(failedRow),
      });
    }

    // 026-C3: owner_action_required does NOT mark the step complete and is
    // NOT a durable failure — it is re-derived from authoritative server
    // truth on every execute (reload/remount/resume converge back to it).
    // The UI renders the required owner action (ads destination capture, or
    // the explicit campaign-launch authorization) and calls execute again.
    if (outcome.status === "owner_action_required") {
      const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
      return res.json({
        allComplete: false,
        step: { key: nextAction.key, label: nextAction.label },
        status: "owner_action_required",
        action: outcome.action || null,
        detail: outcome.detail,
        remaining,
        session: serializeSession(await reloadSession(session.session_id)),
      });
    }

    // needs_connection does NOT mark the step complete — the UI resolves the OAuth
    // handoff and calls execute again (or sends skip:true to move on).
    if (outcome.status === "needs_connection") {
      const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
      return res.json({
        allComplete: false,
        step: { key: nextAction.key, label: nextAction.label },
        status: "needs_connection",
        connect: outcome.connect || null,
        detail: outcome.detail,
        remaining,
        session: serializeSession(await reloadSession(session.session_id)),
      });
    }

    completed.push(nextAction.key);
    const updatedRow = await writeCompletedSteps(session.session_id, completed, {
      key: nextAction.key,
      outcome: outcome.status === "skipped" ? "skipped" : "completed",
    });
    if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
    const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
    return res.json({
      allComplete: false,
      step: { key: nextAction.key, label: nextAction.label },
      status: outcome.status,
      detail: outcome.detail,
      remaining,
      session: serializeSession(updatedRow),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Setup agent execute error:", err.message);
    // 026-C2 / AM-C2-1: a 5xx here is an internal/system fault whose raw text
    // (DB/provider detail) must never reach the browser. 4xx messages are our
    // own user-facing texts and pass through unchanged.
    const safeMessage =
      status >= 500
        ? "Something went wrong while running this step. Your progress is saved — you can retry."
        : err.message || "A setup step failed";
    return res.status(status).json({ error: safeMessage });
  } finally {
    // Stop the heartbeat and release the lease, even on error, so the next
    // /execute call (or a retry after a failed step) can proceed immediately.
    clearInterval(heartbeat);
    await releaseExecution(session.session_id, leaseToken);
  }
}

/**
 * POST /api/setup-agent/pause  { sessionId }
 * Marks an active (interview-phase) session paused when the user leaves the flow,
 * stamping paused_at. Resuming (via initiateSession) flips it back to in_progress
 * and stamps resumed_at. Best-effort: a no-op if the session isn't pausable.
 */
async function markSessionPaused(sessionId, userId) {
  // Best-effort, idempotent: only an in-progress row for this owner flips to
  // paused, so a repeat call (e.g. beacon then in-app unmount) is a harmless
  // no-op that never resurrects a completed/dismissed session.
  await db.query(
    `UPDATE setup_sessions
       SET status = 'paused', paused_at = NOW(), updated_at = NOW()
     WHERE session_id = $1 AND user_id = $2 AND status = 'in_progress'`,
    [sessionId, userId],
  );
}

async function pauseSession(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    await markSessionPaused(sessionId, userId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Setup agent pause error:", err.message);
    return res.status(500).json({ error: "Failed to pause the setup session" });
  }
}

/**
 * POST /api/setup-agent/pause-beacon  { sessionId, token }
 * sendBeacon-friendly pause used on hard tab/window close, where a React unmount
 * effect and an Authorization header both can't be relied on. The Beacon API
 * can't set headers, so the JWT rides in the body and is verified here instead
 * of via the auth middleware. Always answers 204 (fire-and-forget; the browser
 * is unloading and won't read the response) and never resurrects a session that
 * isn't 'in_progress' for the token's owner.
 */
async function pauseSessionBeacon(req, res) {
  const { sessionId, token } = req.body || {};
  if (sessionId && token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.userId) {
        await markSessionPaused(sessionId, decoded.userId);
      }
    } catch (err) {
      // Invalid/expired token or DB hiccup: swallow — the page is unloading and
      // a stale-timestamp session is preferable to blocking the unload.
    }
  }
  return res.status(204).end();
}

/**
 * POST /api/setup-agent/dismiss  { sessionId }
 * Marks the session dismissed so the agent doesn't auto-launch again.
 */
async function dismissSession(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    const result = await db.query(
      `UPDATE setup_sessions
         SET status = 'dismissed', consent_granted = FALSE, updated_at = NOW()
       WHERE session_id = $1 AND user_id = $2 AND status NOT IN ('completed', 'dismissed')
       RETURNING *`,
      [sessionId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Active setup session not found" });
    }
    return res.json({ session: serializeSession(result.rows[0]) });
  } catch (err) {
    console.error("Setup agent dismiss error:", err.message);
    return res.status(500).json({ error: "Failed to dismiss the setup session" });
  }
}

/**
 * POST /api/setup-agent/reset
 * Clears the caller's setup-agent history so they can re-experience the
 * brand-new-user flow (the automatic greeting + a fresh interview). Deletes the
 * user's own setup_sessions rows only; owner-scoped like the rest of this route
 * group. Returns how many sessions were cleared.
 */
async function resetSetup(req, res) {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      "DELETE FROM setup_sessions WHERE user_id = $1",
      [userId],
    );
    return res.json({ cleared: result.rowCount || 0 });
  } catch (err) {
    console.error("Setup agent reset error:", err.message);
    return res.status(500).json({ error: "Failed to reset the setup agent" });
  }
}

/**
 * GET /api/setup-agent/latest
 * Returns a light summary of the caller's most recent session (or null) so the
 * client can decide whether to auto-launch the agent for a brand-new user.
 */
async function getLatestSession(req, res) {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      "SELECT * FROM setup_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    if (result.rows.length === 0) return res.json({ session: null });
    return res.json({ session: serializeSession(result.rows[0]) });
  } catch (err) {
    console.error("Setup agent latest error:", err.message);
    return res.status(500).json({ error: "Failed to load setup status" });
  }
}

/**
 * POST /api/setup-agent/transcribe  (auth → lockout → requireOwner)
 * Fallback transcription for the Setup Agent's voice input, used when the
 * browser has no Web Speech API. Accepts a recorded audio blob ("audio"),
 * transcribes it with the existing OpenAI Whisper infrastructure, and returns
 * { text }. AI/upstream failures map to 502 (never mocked), matching the rest
 * of the Setup Agent.
 */
async function transcribeVoiceInput(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "An audio recording is required" });
  }
  try {
    const text = await voiceController.transcribeAudio(req.file);
    return res.json({ text: typeof text === "string" ? text.trim() : "" });
  } catch (err) {
    console.error("Setup agent transcription error:", err.message);
    return res.status(502).json({ error: "Could not transcribe your voice. Please try again or type your answer." });
  }
}

module.exports = {
  initiateSession,
  submitAnswer,
  transcribeVoiceInput,
  grantConsent,
  executeNextAction,
  pauseSession,
  pauseSessionBeacon,
  dismissSession,
  resetSetup,
  getLatestSession,
  // Exported for the reliability test suite (tests/setupAgent.*.test.js).
  ACTIONS,
  isTerminalSetupJourney,
  // 026-C3 (I-61): exported so the owner-action suite can bind marker-first
  // classification and the bounded template set directly.
  classifyStepError,
  STEP_FAILURE_TEMPLATES,
  isActionAllowed,
  pickAdBudget,
  pickMonthlyAdBudget,
  extractWorkingStyle,
  wantsGoogleAds,
  claimExecution,
  heartbeatExecution,
  releaseExecution,
  EXECUTION_LEASE_SECONDS,
  EXECUTION_HEARTBEAT_MS,
  // Prompt 023 seams/exports for tests. _createMessage is the governed AI
  // chokepoint (config/anthropic.createMessage) — stubbed by interview tests.
  _createMessage: createMessage,
  loadInterviewInventory,
  resolveKnowledgeAnswer,
  buildDirectorNote,
  interviewState,
  // Prompt 035 Stage 2 seams for tests.
  applyStatedFacts,
  STATED_FACT_MAP,
  // 035-C1 H-5 seam: exposes the early-brand transaction body so the G1
  // losing-race rollback can be exercised deterministically. Export only —
  // no behavior change.
  _ensureInterviewBrand: ensureInterviewBrand,
  _c2LogPush: c2LogPush,
  // 026-C1 seams for tests: the atomic completed_steps + step_outcomes write
  // and the serializer that surfaces stepOutcomes to the client.
  writeCompletedSteps,
  serializeSession,
  // 026-C3-PM5 seams for tests: the canonical launch-completion predicate,
  // the completed_steps reconciliation, and the step-error classifier.
  _facebookCampaignLaunchComplete: facebookCampaignLaunchComplete,
  _reconcileCompletedSteps: reconcileCompletedSteps,
  _classifyStepError: classifyStepError,
  _isDeferrableFailedOutcome: isDeferrableFailedOutcome,
  _isValidOwnerDirectedDeferral: isValidOwnerDirectedDeferral,
  _enrichOwnerDirectedDeferral: enrichOwnerDirectedDeferral,
  STEP_FAILURE_TEMPLATES,
};
