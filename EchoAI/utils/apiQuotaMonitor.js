/**
 * API credit & quota monitor (Sentinel).
 *
 * Sentinel checks the platform's third-party API credit/quota levels every hour
 * and alerts the platform owner (admin / "James") by voice + web push when any
 * service drops below a warning (20% remaining) or critical threshold, so no
 * service ever runs out silently. The latest level for every provider is stored
 * so the Sentinel health monitor can show them all at a glance.
 *
 * HONESTY RULE (EchoAI convention — never fabricate data): only providers that
 * actually expose remaining credits/quota through an API return real numbers.
 *   - ElevenLabs: GET /user/subscription → character_count + character_limit.
 *   - Twilio:     GET Balance.json → account balance (only when platform-level
 *                 Twilio credentials are configured).
 * OpenAI, Anthropic and Google Cloud do NOT expose remaining credits/quota via
 * an API key, so they are reported as "unavailable" (or "not_configured") with a
 * plain-English reason — never a made-up number.
 */

const db = require("../config/db");
const elevenLabsConfig = require("../config/elevenlabs");
const { enqueueOwnerVoiceEvent } = require("./echoVoiceNotifications");
const pushController = require("../controllers/pushController");

// Warn at 20% remaining, critical at 5% remaining (mirrors the owner's ask).
const LOW_PCT = 20;
const CRITICAL_PCT = 5;

// Ordered list drives both iteration and display order.
const PROVIDER_ORDER = ["elevenlabs", "openai", "anthropic", "twilio", "google"];

const HTTP_TIMEOUT_MS = 15000;

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null; // non-JSON body (surfaced via text)
    }
    return { ok: resp.ok, status: resp.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}

function numOrNull(v) {
  // Preserve null semantics: unavailable/not-configured providers report null
  // numeric fields and must NOT be persisted as 0 (Number(null) === 0), which
  // would fabricate a quota level (EchoAI honesty rule — never invent numbers).
  if (v === null || v === undefined || v === "") return null;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function pctOf(remaining, limit) {
  if (!(limit > 0)) return null;
  return Math.max(0, Math.min(100, (remaining / limit) * 100));
}

/** Classify a limit-based provider (has a percentage) with optional absolute floors. */
function classify(pct, remaining, { criticalAbs = null, lowAbs = null } = {}) {
  if (pct != null && pct <= CRITICAL_PCT) return "critical";
  if (criticalAbs != null && remaining != null && remaining <= criticalAbs) return "critical";
  if (pct != null && pct <= LOW_PCT) return "low";
  if (lowAbs != null && remaining != null && remaining <= lowAbs) return "low";
  return "ok";
}

/** Classify a balance-based provider (no percentage — purely absolute floors). */
function classifyBalance(balance, { criticalAbs, lowAbs }) {
  if (!Number.isFinite(balance)) return "error";
  if (balance <= criticalAbs) return "critical";
  if (balance <= lowAbs) return "low";
  return "ok";
}

/**
 * Rough days-remaining estimate for ElevenLabs from this period's burn rate.
 * Best-effort and clearly labelled "approximate" by callers; returns null when
 * it can't be estimated sanely (avoids inventing a misleading number).
 */
function estimateDaysLeft(used, remaining, resetUnix) {
  if (!(used > 0) || !(remaining > 0)) return null;
  const cycleDays = 30; // ElevenLabs plans reset monthly
  const now = Date.now() / 1000;
  if (!resetUnix || resetUnix <= now) return null;
  const daysUntilReset = (resetUnix - now) / 86400;
  if (daysUntilReset < 0 || daysUntilReset > cycleDays) return null;
  const daysElapsed = cycleDays - daysUntilReset;
  if (!(daysElapsed > 0.5)) return null;
  const dailyBurn = used / daysElapsed;
  if (!(dailyBurn > 0)) return null;
  const daysLeft = Math.floor(remaining / dailyBurn);
  if (!Number.isFinite(daysLeft) || daysLeft < 0 || daysLeft > 3650) return null;
  return daysLeft;
}

// ---------------------------------------------------------------------------
// Provider checks. Each returns a normalized snapshot object.
// ---------------------------------------------------------------------------

async function checkElevenLabs() {
  const base = { provider: "elevenlabs", label: "ElevenLabs", unit: "characters" };
  if (!elevenLabsConfig.apiKey()) {
    return { ...base, configured: false, status: "not_configured", detail: "ElevenLabs API key is not configured." };
  }
  try {
    const { ok, status, json, text } = await fetchJson(
      `${elevenLabsConfig.API_BASE}/user/subscription`,
      { headers: { "xi-api-key": elevenLabsConfig.apiKey(), Accept: "application/json" } },
    );
    if (!ok || !json) {
      return { ...base, configured: true, status: "error", detail: `ElevenLabs quota check failed (${status}): ${(text || "").slice(0, 120)}` };
    }
    const used = Number(json.character_count) || 0;
    const limit = Number(json.character_limit) || 0;
    const remaining = Math.max(0, limit - used);
    const pct = pctOf(remaining, limit);
    const daysLeft = estimateDaysLeft(used, remaining, Number(json.next_character_count_reset_unix));
    const dayPhrase = daysLeft != null ? ` · about ${daysLeft} day${daysLeft === 1 ? "" : "s"} at your recent pace` : "";
    return {
      ...base,
      configured: true,
      used,
      limitTotal: limit,
      remaining,
      pctRemaining: pct,
      daysLeft,
      status: classify(pct, remaining, { criticalAbs: 2000 }),
      detail: `${fmtInt(remaining)} of ${fmtInt(limit)} characters left${pct != null ? ` (${pct.toFixed(1)}%)` : ""}${dayPhrase} · ${json.tier || "plan"} plan`,
    };
  } catch (err) {
    return { ...base, configured: true, status: "error", detail: `ElevenLabs quota check error: ${err.message}` };
  }
}

async function checkTwilio() {
  const base = { provider: "twilio", label: "Twilio", unit: "usd" };
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.SALES_TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.SALES_TWILIO_AUTH_TOKEN || "";
  if (!sid || !token) {
    return { ...base, configured: false, status: "not_configured", detail: "Platform-level Twilio credentials are not configured." };
  }
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const { ok, status, json, text } = await fetchJson(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );
    if (!ok || !json) {
      return { ...base, configured: true, status: "error", detail: `Twilio balance check failed (${status}): ${(text || "").slice(0, 120)}` };
    }
    const balance = Number(json.balance);
    const currency = json.currency || "USD";
    return {
      ...base,
      configured: true,
      unit: String(currency).toLowerCase(),
      remaining: Number.isFinite(balance) ? balance : null,
      limitTotal: null,
      pctRemaining: null,
      status: classifyBalance(balance, { criticalAbs: 5, lowAbs: 20 }),
      detail: Number.isFinite(balance)
        ? `${currency} ${balance.toFixed(2)} account balance remaining`
        : "Twilio balance unavailable",
    };
  } catch (err) {
    return { ...base, configured: true, status: "error", detail: `Twilio balance check error: ${err.message}` };
  }
}

/** Providers that don't expose remaining quota via an API key. Honest, no numbers. */
function unavailableProvider({ provider, label, envKey, reason }) {
  const configured = Boolean(process.env[envKey]);
  return {
    provider,
    label,
    unit: null,
    configured,
    used: null,
    limitTotal: null,
    remaining: null,
    pctRemaining: null,
    status: configured ? "unavailable" : "not_configured",
    detail: configured ? reason : `${label} API key is not configured.`,
  };
}

async function checkOpenAI() {
  return unavailableProvider({
    provider: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    reason: "OpenAI does not expose remaining credits or quota through the API — review usage limits in the OpenAI dashboard.",
  });
}

async function checkAnthropic() {
  return unavailableProvider({
    provider: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    reason: "Anthropic does not expose remaining credits or quota through the API — review usage in the Anthropic Console.",
  });
}

async function checkGoogle() {
  const configured = Boolean(
    process.env.GOOGLE_API_KEY || process.env.YOUTUBE_API_KEY || process.env.GOOGLE_CLOUD_PROJECT,
  );
  return {
    provider: "google",
    label: "Google Cloud",
    unit: null,
    configured,
    used: null,
    limitTotal: null,
    remaining: null,
    pctRemaining: null,
    status: configured ? "unavailable" : "not_configured",
    detail: configured
      ? "Google Cloud does not expose remaining quota via an API key — review quotas in the Google Cloud console."
      : "Google Cloud credentials are not configured.",
  };
}

const CHECKS = {
  elevenlabs: checkElevenLabs,
  openai: checkOpenAI,
  anthropic: checkAnthropic,
  twilio: checkTwilio,
  google: checkGoogle,
};

// ---------------------------------------------------------------------------
// Persistence + alerting
// ---------------------------------------------------------------------------

async function resolveAdmin() {
  try {
    const r = await db.query(
      "SELECT user_id, first_name FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
    );
    return r.rows[0] || null;
  } catch (err) {
    console.error("API quota: admin lookup failed:", err.message);
    return null;
  }
}

async function upsertSnapshot(c) {
  await db.query(
    `INSERT INTO api_quota_snapshots
       (provider, label, status, used, limit_total, remaining, pct_remaining, unit, detail, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       label = EXCLUDED.label,
       status = EXCLUDED.status,
       used = EXCLUDED.used,
       limit_total = EXCLUDED.limit_total,
       remaining = EXCLUDED.remaining,
       pct_remaining = EXCLUDED.pct_remaining,
       unit = EXCLUDED.unit,
       detail = EXCLUDED.detail,
       checked_at = NOW()`,
    [
      c.provider,
      c.label,
      c.status,
      numOrNull(c.used),
      numOrNull(c.limitTotal),
      numOrNull(c.remaining),
      numOrNull(c.pctRemaining),
      c.unit || null,
      c.detail || null,
    ],
  );
}

function remainingPhrase(c) {
  if (c.unit === "characters" && Number.isFinite(c.remaining)) {
    const days = Number.isFinite(c.daysLeft)
      ? `, which is about ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} of normal usage`
      : "";
    return `${fmtInt(c.remaining)} characters remaining${days}`;
  }
  if (c.unit === "usd" && Number.isFinite(c.remaining)) {
    return `$${c.remaining.toFixed(2)} of account balance remaining`;
  }
  if (Number.isFinite(c.remaining)) {
    return `${fmtInt(c.remaining)}${c.unit ? ` ${c.unit}` : ""} remaining`;
  }
  return "a low remaining balance";
}

/** Claim + send the voice + push alert for a low/critical provider. Best-effort. */
async function maybeAlert(c, admin, dayStr) {
  if (!admin) return false;
  if (c.status !== "low" && c.status !== "critical") return false;

  let claimed = false;
  try {
    const r = await db.query(
      `INSERT INTO api_quota_alert_log (provider, severity, alert_date)
       VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT (provider, severity, alert_date) DO NOTHING
       RETURNING id`,
      [c.provider, c.status],
    );
    claimed = r.rows.length > 0;
  } catch (err) {
    console.error("API quota alert claim failed:", err.message);
    return false;
  }
  if (!claimed) return false;

  const phrase = remainingPhrase(c);
  const urgent = c.status === "critical";

  await enqueueOwnerVoiceEvent(
    admin.user_id,
    "api_quota",
    (name) =>
      urgent
        ? `${name}, urgent — your ${c.label} credits are critically low. You have approximately ${phrase}. Want me to remind you to top up right away?`
        : `${name}, your ${c.label} credits are getting low. You have approximately ${phrase}. Want me to remind you to top up?`,
    {
      title: `${c.label} credits ${urgent ? "critically low" : "low"}`,
      dedupKey: `api_quota:${c.provider}:${c.status}:${dayStr}`,
    },
  );

  try {
    await pushController.sendPushToUser(admin.user_id, {
      title: urgent ? `${c.label} credits critically low` : `${c.label} credits low`,
      body: `Approximately ${phrase}. Open Sentinel to review API credits.`,
      url: "/dashboard?section=sentinelhealth",
      tag: `api-quota-${c.provider}`,
    });
  } catch (err) {
    console.error("API quota push failed:", err.message);
  }
  return true;
}

/**
 * Run one full sweep over every provider: check, persist the latest snapshot, and
 * (when notify) alert the platform owner for any provider at/below threshold.
 * Per-provider failures are logged and never abort the sweep.
 */
async function runApiQuotaSweep({ notify = true } = {}) {
  const admin = notify ? await resolveAdmin() : null;
  const dayStr = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const provider of PROVIDER_ORDER) {
    try {
      const c = await CHECKS[provider]();
      await upsertSnapshot(c);
      results.push(c);
      if (notify) await maybeAlert(c, admin, dayStr);
    } catch (err) {
      console.error(`API quota check failed for ${provider}:`, err.message);
    }
  }
  const flagged = results.filter((r) => r.status === "low" || r.status === "critical").length;
  console.log(`API quota sweep complete: ${results.length}/${PROVIDER_ORDER.length} providers checked, ${flagged} at/below threshold.`);
  return results;
}

/** Latest stored snapshot for every provider, in display order. */
async function getSnapshots() {
  const { rows } = await db.query(
    `SELECT provider, label, status, used, limit_total, remaining, pct_remaining, unit, detail, checked_at
     FROM api_quota_snapshots`,
  );
  const byId = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDER_ORDER.map((p) => byId.get(p)).filter(Boolean);
}

module.exports = {
  runApiQuotaSweep,
  getSnapshots,
  PROVIDER_ORDER,
  LOW_PCT,
  CRITICAL_PCT,
  // exported for tests
  classify,
  classifyBalance,
  estimateDaysLeft,
  checkElevenLabs,
  checkTwilio,
  checkOpenAI,
  checkAnthropic,
  checkGoogle,
};
