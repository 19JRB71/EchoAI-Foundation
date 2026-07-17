require("dotenv").config();

const db = require("./db");
const { ENVIRONMENT, isProduction } = require("./environment");

/**
 * Emergency AI switches and budget limits.
 *
 * Resolution order for every control: ai_settings DB row (admin override,
 * takes effect within CACHE_TTL_MS without a redeploy) > environment variable
 * of the same name > built-in default. Values are cached briefly so gating a
 * paid call never adds a meaningful DB cost.
 */

// Boolean switches. Defaults implement the launch-sprint policy:
// - Background AI runs only in production, and Sage's 30-minute urgent scan,
//   the weekly Monday AI stack, and autonomous growth are OFF until explicitly
//   re-enabled by the administrator.
// - Development never makes paid calls unless DEVELOPMENT_AI_ENABLED is set.
const SWITCH_DEFAULTS = {
  AI_ENABLED: true, // master emergency shutoff (false = no paid calls at all)
  USER_AI_ENABLED: true, // user-requested AI (chat, content the owner asks for)
  BACKGROUND_AI_ENABLED: true, // scheduled/autonomous AI (production only)
  SAGE_RESEARCH_ENABLED: true, // Sage deep industry research (now daily)
  SAGE_URGENT_ENABLED: false, // Sage 30-minute urgent scan (launch default OFF)
  COMPETITOR_RESEARCH_ENABLED: true, // competitor scan/ad spy/site monitor (now daily)
  WEEKLY_AI_STACK_ENABLED: false, // Monday analytics/intel/learning/self-review/autopilot
  AUTONOMOUS_GROWTH_ENABLED: false, // daily autonomous growth review (launch default OFF)
  DEVELOPMENT_AI_ENABLED: false, // allow paid calls outside production
  OPENAI_CONTENT_ENABLED: false, // OpenAI as a content provider (future pilot)
  SAGE_V2_CONTEXT: false, // Sage V2 P1: inject approved Company Truth into every department's AI context (dark until enabled)
  SAGE_V2_WEEKLY_BRIEFING: false, // Sage V2 P1: consolidated weekly Sage briefing (copy pending ChatGPT; dark until enabled)
  SAGE_V2_ROI_LABELS: false, // Sage V2 P1: "estimated" badges on modeled ROI figures (dark until enabled)
  SAGE_V2_INTEL_STORE: false, // Sage V2 P2: canonical sage_intel_items store (writes+reads cut over; dark until enabled)
  SAGE_V2_JOB_QUEUE: false, // Sage V2 P2: scheduler enqueues per-brand AI work into sage_job_queue (dark until enabled)
  SAGE_V2_SKIP_GATES: false, // Sage V2 P2: input-hash skip gates — unchanged inputs make zero AI calls (dark until enabled)
  SAGE_V2_DQ_SENTRY: false, // Sage V2 P2: nightly deterministic data-quality sentry (dark until enabled)
  ANTHROPIC_CONTENT_ENABLED: true, // Anthropic (Claude) calls
};

// Numeric limits (USD unless noted). All periods are UTC days/months.
const NUMBER_DEFAULTS = {
  AI_BUDGET_GLOBAL_DAILY_USD: 25,
  AI_BUDGET_GLOBAL_MONTHLY_USD: 400,
  AI_BUDGET_DEV_DAILY_USD: 2,
  AI_BUDGET_BACKGROUND_DAILY_USD: 10,
  AI_BUDGET_BRAND_DAILY_USD: 10,
  AI_BUDGET_BRAND_MONTHLY_USD: 150,
  AI_MAX_CALLS_PER_MINUTE: 30,
};

const CACHE_TTL_MS = 15000;
let cache = { at: 0, overrides: null };

function parseBool(raw) {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return null;
}

/** Load all ai_settings rows (cached). Never throws — a DB failure falls back
 *  to env/default values so a settings outage can't take AI down by accident. */
async function loadOverrides() {
  const now = Date.now();
  if (cache.overrides && now - cache.at < CACHE_TTL_MS) return cache.overrides;
  try {
    const r = await db.query("SELECT key, value FROM ai_settings");
    const map = {};
    for (const row of r.rows) map[row.key] = row.value;
    cache = { at: now, overrides: map };
  } catch (err) {
    // Table may not exist yet (pre-migration) or DB hiccup: use env/defaults.
    if (!/relation "ai_settings" does not exist/i.test(err.message || "")) {
      console.error("aiControls: failed to load ai_settings:", err.message);
    }
    cache = { at: now, overrides: {} };
  }
  return cache.overrides;
}

async function getSwitch(name) {
  if (!(name in SWITCH_DEFAULTS)) throw new Error(`Unknown AI switch: ${name}`);
  const overrides = await loadOverrides();
  const fromDb = parseBool(overrides[name]);
  if (fromDb != null) return fromDb;
  const fromEnv = parseBool(process.env[name]);
  if (fromEnv != null) return fromEnv;
  return SWITCH_DEFAULTS[name];
}

async function getNumber(name) {
  if (!(name in NUMBER_DEFAULTS)) throw new Error(`Unknown AI limit: ${name}`);
  const overrides = await loadOverrides();
  for (const raw of [overrides[name], process.env[name]]) {
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return NUMBER_DEFAULTS[name];
}

/** Full effective view (for the admin status endpoint): every control with its
 *  effective value and where it came from. */
async function describeControls() {
  const overrides = await loadOverrides();
  const describe = (name, defaults, parse) => {
    const fromDb = parse(overrides[name]);
    if (fromDb != null) return { name, value: fromDb, source: "admin setting" };
    const fromEnv = parse(process.env[name]);
    if (fromEnv != null) return { name, value: fromEnv, source: "environment variable" };
    return { name, value: defaults[name], source: "default" };
  };
  const parseNum = (raw) => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    environment: ENVIRONMENT,
    switches: Object.keys(SWITCH_DEFAULTS).map((k) => describe(k, SWITCH_DEFAULTS, parseBool)),
    limits: Object.keys(NUMBER_DEFAULTS).map((k) => describe(k, NUMBER_DEFAULTS, parseNum)),
  };
}

/** Admin write path. Only known keys are accepted. */
async function setControl(key, value, updatedBy) {
  const isSwitch = key in SWITCH_DEFAULTS;
  const isNumber = key in NUMBER_DEFAULTS;
  if (!isSwitch && !isNumber) throw new Error(`Unknown AI control: ${key}`);
  let stored;
  if (isSwitch) {
    const parsed = parseBool(value);
    if (parsed == null) throw new Error(`"${key}" must be true or false.`);
    stored = String(parsed);
  } else {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`"${key}" must be a non-negative number.`);
    stored = String(n);
  }
  await db.query(
    `INSERT INTO ai_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
    [key, stored, updatedBy || null],
  );
  cache = { at: 0, overrides: null }; // take effect immediately in this process
  return { key, value: stored };
}

/** Clear an admin override so env var / default applies again. */
async function clearControl(key) {
  await db.query("DELETE FROM ai_settings WHERE key = $1", [key]);
  cache = { at: 0, overrides: null };
}

/** True when background AI may run in THIS environment at all. */
async function backgroundAiAllowedHere() {
  if (!isProduction() && !(await getSwitch("DEVELOPMENT_AI_ENABLED"))) {
    return { allowed: false, reason: `background AI is disabled outside production (environment: ${ENVIRONMENT})` };
  }
  if (!(await getSwitch("AI_ENABLED"))) {
    return { allowed: false, reason: "the emergency AI shutoff is on (AI_ENABLED=false)" };
  }
  if (!(await getSwitch("BACKGROUND_AI_ENABLED"))) {
    return { allowed: false, reason: "background AI is switched off (BACKGROUND_AI_ENABLED=false)" };
  }
  return { allowed: true };
}

function _resetCacheForTests() {
  cache = { at: 0, overrides: null };
}

module.exports = {
  SWITCH_DEFAULTS,
  NUMBER_DEFAULTS,
  getSwitch,
  getNumber,
  describeControls,
  setControl,
  clearControl,
  backgroundAiAllowedHere,
  _resetCacheForTests,
};
