const crypto = require("crypto");
const db = require("../config/db");
const { ENVIRONMENT, DEPLOY_VERSION } = require("../config/environment");
const { getAiContext } = require("./aiContext");

/**
 * Central AI usage ledger. Every paid provider call (Anthropic, Hermes, OpenAI)
 * records one row here — success or failure — with real usage metadata from the
 * provider response whenever available. Budgets read their spend from this
 * table, so recording must never be skipped on the success path.
 */

// USD per 1M tokens. Env-overridable so a price change never needs a deploy.
// Sources: Anthropic + OpenAI published API pricing at time of writing; Hermes
// (Nous Portal) is estimated conservatively and billed to a separate account.
function num(envName, fallback) {
  const n = Number(process.env[envName]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const PRICING = {
  anthropic: {
    inputPerM: num("AI_PRICE_ANTHROPIC_INPUT_PER_M", 3.0),
    outputPerM: num("AI_PRICE_ANTHROPIC_OUTPUT_PER_M", 15.0),
    cachedInputPerM: num("AI_PRICE_ANTHROPIC_CACHED_INPUT_PER_M", 0.3),
    perWebSearch: num("AI_PRICE_ANTHROPIC_WEB_SEARCH", 0.01),
  },
  hermes: {
    inputPerM: num("AI_PRICE_HERMES_INPUT_PER_M", 0.7),
    outputPerM: num("AI_PRICE_HERMES_OUTPUT_PER_M", 2.8),
    cachedInputPerM: 0,
    perWebSearch: 0,
  },
  openai: {
    inputPerM: num("AI_PRICE_OPENAI_INPUT_PER_M", 2.5),
    outputPerM: num("AI_PRICE_OPENAI_OUTPUT_PER_M", 10.0),
    cachedInputPerM: num("AI_PRICE_OPENAI_CACHED_INPUT_PER_M", 1.25),
    perWebSearch: 0,
  },
};

// Flat per-unit prices for non-token OpenAI modalities.
const UNIT_PRICES = {
  "openai:image": num("AI_PRICE_OPENAI_IMAGE", 0.08), // DALL-E 3 1024x1024 HD-ish
  "openai:tts_per_1k_chars": num("AI_PRICE_OPENAI_TTS_PER_1K_CHARS", 0.015),
  "openai:stt_per_minute": num("AI_PRICE_OPENAI_STT_PER_MINUTE", 0.006),
  "elevenlabs:tts_per_1k_chars": num("AI_PRICE_ELEVENLABS_TTS_PER_1K_CHARS", 0.15),
};

// Per-unit prices for communications providers. Estimates, env-overridable;
// real reconciliation against provider billing APIs is a later approved phase.
const COMM_UNIT_PRICES = {
  "twilio:sms_segment": num("COST_TWILIO_SMS_SEGMENT", 0.0079),
  "twilio:voice_minute": num("COST_TWILIO_VOICE_MINUTE", 0.014),
  "email:send": num("COST_EMAIL_SEND", 0.0004),
  "google_search:search": num("COST_GOOGLE_SEARCH", 0.005),
  "elevenlabs:sound_generation": num("COST_ELEVENLABS_SOUND", 0.08),
};

function estimateTokenCost(provider, { inputTokens = 0, outputTokens = 0, cachedInputTokens = 0, webSearches = 0 }) {
  const p = PRICING[provider];
  if (!p) return 0;
  const freshInput = Math.max(0, inputTokens);
  return (
    (freshInput * p.inputPerM +
      Math.max(0, outputTokens) * p.outputPerM +
      Math.max(0, cachedInputTokens) * p.cachedInputPerM) /
      1e6 +
    Math.max(0, webSearches) * p.perWebSearch
  );
}

function newRequestId() {
  return crypto.randomUUID();
}

/**
 * Fire-and-forget ledger write. NEVER throws and never blocks the AI response
 * path — a ledger outage must not take AI features down. Returns a promise the
 * caller may ignore (tests await it).
 */
function recordUsage(entry) {
  const ctx = getAiContext();
  const cost =
    entry.estimatedCostUsd != null
      ? entry.estimatedCostUsd
      : estimateTokenCost(entry.provider, {
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cachedInputTokens: entry.cachedInputTokens,
          webSearches: entry.webSearches,
        });
  return db
    .query(
      `INSERT INTO ai_usage_log
         (environment, deploy_version, provider, model, brand_id, user_id, agent,
          feature, task_type, job_name, request_id, conversation_id, triggered_by,
          input_tokens, output_tokens, cached_input_tokens, web_searches,
          retry_count, duration_ms, success, error_category, estimated_cost_usd,
          cache_checked, cache_hit, cache_miss_reason, fallback_used,
          workflow_id, parent_request_id, unit_type, unit_quantity, provider_ref,
          key_label, provider_charged_on_failure)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        entry.environment || ENVIRONMENT,
        entry.deployVersion || DEPLOY_VERSION,
        entry.provider,
        entry.model || null,
        entry.brandId || ctx.brandId || null,
        entry.userId || ctx.userId || null,
        entry.agent || ctx.agent || null,
        entry.feature || ctx.feature || "unlabeled",
        entry.taskType || null,
        entry.jobName || ctx.jobName || null,
        entry.requestId || null,
        entry.conversationId || ctx.conversationId || null,
        entry.triggeredBy || ctx.triggeredBy || "user",
        entry.inputTokens ?? null,
        entry.outputTokens ?? null,
        entry.cachedInputTokens ?? null,
        entry.webSearches ?? null,
        entry.retryCount || 0,
        entry.durationMs ?? null,
        entry.success !== false,
        entry.errorCategory || null,
        Math.round(cost * 1e6) / 1e6,
        entry.cacheChecked === true,
        entry.cacheHit === true,
        entry.cacheMissReason || null,
        entry.fallbackUsed === true,
        entry.workflowId || ctx.workflowId || null,
        entry.parentRequestId || ctx.parentRequestId || null,
        entry.unitType || null,
        entry.unitQuantity ?? null,
        entry.providerRef || null,
        entry.keyLabel || null,
        entry.providerChargedOnFailure ?? null,
      ],
    )
    .catch((err) => {
      if (!/relation "ai_usage_log" does not exist/i.test(err.message || "")) {
        console.error("aiUsage: failed to record usage:", err.message);
      }
    });
}

/**
 * Ledger write for a non-LLM billable unit (SMS segment, voice minute, email
 * send, TTS characters, search). Computes the estimated cost from
 * COMM_UNIT_PRICES unless the caller supplies one. Same fire-and-forget
 * safety contract as recordUsage: never throws, never blocks the send.
 */
function recordCommsUsage({ provider, unitType, unitQuantity = 1, ...rest }) {
  const rate = COMM_UNIT_PRICES[`${provider}:${unitType}`];
  const estimatedCostUsd =
    rest.estimatedCostUsd != null
      ? rest.estimatedCostUsd
      : rate != null
        ? rate * Math.max(0, Number(unitQuantity) || 0)
        : 0;
  return recordUsage({
    ...rest,
    provider,
    unitType,
    unitQuantity,
    estimatedCostUsd,
    requestId: rest.requestId || newRequestId(),
  });
}

/** Classify an error for the ledger. */
function categorizeAiError(err) {
  if (!err) return "unknown";
  if (err.aiBlocked) return "blocked_by_policy";
  const status = err.status;
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400) return "bad_request";
  if (typeof status === "number" && status >= 500) return "provider_error";
  const msg = String(err.message || "");
  if (/credit|billing|quota/i.test(msg)) return "billing";
  if (/timeout|timed out|abort/i.test(msg) || /Timeout/i.test(String(err.name))) return "timeout";
  if (/ECONNRESET|ECONNREFUSED|EPIPE|fetch failed|Connection/i.test(msg + String(err.code || err.name))) {
    return "network";
  }
  return "unknown";
}

// --- Spend queries (used by budgets + the admin dashboard) -------------------

/**
 * Spend snapshot for budget checks, in one query. UTC periods.
 * Cached briefly: budget checks run before every paid call and must stay cheap.
 */
const SPEND_CACHE_TTL_MS = 20000;
let spendCache = { at: 0, value: null };

async function getGlobalSpend() {
  const now = Date.now();
  if (spendCache.value && now - spendCache.at < SPEND_CACHE_TTL_MS) return spendCache.value;
  const r = await db.query(
    `SELECT
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS today,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS month,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE triggered_by = 'background'
                AND at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS background_today,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE environment <> 'production'
                AND at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS dev_today
     FROM ai_usage_log`,
  );
  const row = r.rows[0] || {};
  const value = {
    today: Number(row.today) || 0,
    month: Number(row.month) || 0,
    backgroundToday: Number(row.background_today) || 0,
    devToday: Number(row.dev_today) || 0,
  };
  spendCache = { at: now, value };
  return value;
}

const brandSpendCache = new Map(); // brandId -> { at, value }

async function getBrandSpend(brandId) {
  const now = Date.now();
  const hit = brandSpendCache.get(brandId);
  if (hit && now - hit.at < SPEND_CACHE_TTL_MS) return hit.value;
  const r = await db.query(
    `SELECT
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS today,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS month
     FROM ai_usage_log WHERE brand_id = $1`,
    [brandId],
  );
  const row = r.rows[0] || {};
  const value = { today: Number(row.today) || 0, month: Number(row.month) || 0 };
  brandSpendCache.set(brandId, { at: now, value });
  if (brandSpendCache.size > 500) brandSpendCache.clear();
  return value;
}

/** Rich summary for the admin dashboard/report. */
async function summarizeUsage() {
  const [totals, byProvider, byFeature, byBrand, byTrigger, expensive] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS today,
         COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS month,
         COUNT(*) FILTER (WHERE at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS calls_today,
         COUNT(*) FILTER (WHERE success = false AND at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS failures_today,
         COALESCE(SUM(estimated_cost_usd) FILTER (WHERE retry_count > 0
                  AND at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS retried_month
       FROM ai_usage_log`,
    ),
    db.query(
      `SELECT provider, COALESCE(SUM(estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
         FROM ai_usage_log
        WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        GROUP BY provider ORDER BY cost DESC`,
    ),
    db.query(
      `SELECT feature, COALESCE(SUM(estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
         FROM ai_usage_log
        WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        GROUP BY feature ORDER BY cost DESC LIMIT 25`,
    ),
    db.query(
      `SELECT u.brand_id, b.brand_name, COALESCE(SUM(u.estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
         FROM ai_usage_log u LEFT JOIN brands b ON b.brand_id = u.brand_id
        WHERE u.at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        GROUP BY u.brand_id, b.brand_name ORDER BY cost DESC LIMIT 25`,
    ),
    db.query(
      `SELECT triggered_by, environment, COALESCE(SUM(estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
         FROM ai_usage_log
        WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        GROUP BY triggered_by, environment ORDER BY cost DESC`,
    ),
    db.query(
      `SELECT at, provider, model, feature, job_name, estimated_cost_usd, input_tokens,
              output_tokens, web_searches, success
         FROM ai_usage_log
        WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ORDER BY estimated_cost_usd DESC LIMIT 10`,
    ),
  ]);
  const t = totals.rows[0] || {};
  const today = Number(t.today) || 0;
  const month = Number(t.month) || 0;
  const dayOfMonth = new Date().getUTCDate();
  return {
    costToday: today,
    costThisMonth: month,
    projectedMonthly: dayOfMonth > 0 ? Math.round(((month / dayOfMonth) * 30) * 100) / 100 : 0,
    callsToday: Number(t.calls_today) || 0,
    failuresToday: Number(t.failures_today) || 0,
    retriedCostThisMonth: Number(t.retried_month) || 0,
    byProvider: byProvider.rows,
    byFeature: byFeature.rows,
    byBrand: byBrand.rows,
    byTriggerAndEnvironment: byTrigger.rows,
    mostExpensiveRequests: expensive.rows,
  };
}

function _resetSpendCacheForTests() {
  spendCache = { at: 0, value: null };
  brandSpendCache.clear();
}

module.exports = {
  PRICING,
  UNIT_PRICES,
  COMM_UNIT_PRICES,
  estimateTokenCost,
  newRequestId,
  recordUsage,
  recordCommsUsage,
  categorizeAiError,
  getGlobalSpend,
  getBrandSpend,
  summarizeUsage,
  _resetSpendCacheForTests,
};
