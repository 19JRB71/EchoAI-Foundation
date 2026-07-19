/**
 * Department Collaboration — Knowledge Registry (Stage 0).
 *
 * The single, code-defined map of every collaboration topic: who owns it,
 * whether it is a `lookup` (answers only from stored, validated data — zero
 * AI cost, always) or `generation` topic (may trigger real work, but only
 * through the owner department's EXISTING gated generation path), its
 * payload schemas, and its dedup freshness window.
 *
 * Approved baseline: ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md §4.
 * Rules enforced here + at the bus chokepoint (utils/collaborationBus.js):
 *  - One owner per topic. Adding a topic means naming its owner and schema
 *    here, in code review — ownership disputes are design-time, not runtime.
 *  - Schema-only payloads: additionalProperties are REJECTED, not stripped.
 *  - Honest empties: every response schema admits an explicit no-data shape.
 *  - No secrets: denylisted key names are rejected as defense in depth
 *    (schemas may never declare credential fields).
 */

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v) => v == null || typeof v === "string";
const isBool = (v) => typeof v === "boolean";
const isOptNum = (v) => v == null || (typeof v === "number" && Number.isFinite(v));
const isOptArr = (v) => v == null || Array.isArray(v);
const isOptObj = (v) => v == null || (typeof v === "object" && !Array.isArray(v));

// Every response schema includes the honest-empty fields: an answer is either
// data (available: true) or an explicit reason it isn't ({} is never an answer).
const honestEmpty = { available: isBool, reason: isOptStr };

/**
 * topic -> {
 *   owner:        the ONLY department allowed to answer it,
 *   class:        'lookup' | 'generation',
 *   freshnessMinutes: dedup window for §10.2 (same answer re-served free),
 *   request:      field -> validator (additionalProperties rejected),
 *   response:     field -> validator (additionalProperties rejected),
 * }
 */
const TOPICS = {
  "strategy.current": {
    owner: "sage",
    class: "lookup",
    freshnessMinutes: 60,
    request: { context: isOptStr },
    response: { ...honestEmpty, strategy: isOptObj, bets: isOptArr, approved_at: isOptStr },
  },
  "truth.company": {
    owner: "sage",
    class: "lookup",
    freshnessMinutes: 360,
    request: { context: isOptStr },
    response: { ...honestEmpty, truth: isOptObj, approved_at: isOptStr, version: isOptNum },
  },
  "scorecard.channel": {
    owner: "sage",
    class: "lookup",
    freshnessMinutes: 60,
    request: { channel: isOptStr, week_start: isOptStr },
    response: { ...honestEmpty, scorecards: isOptArr },
  },
  "intel.competitor": {
    owner: "scout",
    class: "lookup",
    freshnessMinutes: 120,
    request: { focus: isOptStr, limit: isOptNum },
    response: { ...honestEmpty, items: isOptArr },
  },
  "creative.request": {
    owner: "forge",
    // The ONLY generation topic in v1 (§4): flows through Forge's existing
    // gated generation paths (tier checks, cost ledger, approvals unchanged).
    class: "generation",
    freshnessMinutes: 0, // generated work is never dedup-served
    request: { brief: isStr, formats: isOptArr, bet_ref: isOptStr },
    response: { ...honestEmpty, asset_refs: isOptArr, notes: isOptStr },
  },
  "campaign.performance": {
    owner: "atlas",
    class: "lookup",
    freshnessMinutes: 60,
    request: { window_days: isOptNum },
    response: { ...honestEmpty, campaigns: isOptArr, connected: isBool },
  },
  "social.calendar": {
    owner: "nova",
    class: "lookup",
    freshnessMinutes: 30,
    request: { window_days: isOptNum },
    response: { ...honestEmpty, scheduled: isOptArr, published: isOptArr },
  },
  "leads.outcomes": {
    owner: "pulse",
    class: "lookup",
    freshnessMinutes: 60,
    // PII minimization (Appendix B): references + aggregates only, never
    // contact details. lead_refs carries ids; the schema has no name/email/
    // phone fields, so copies of contact data are rejected at the chokepoint.
    request: { window_days: isOptNum },
    response: { ...honestEmpty, coverage: isOptObj, counts: isOptObj, lead_refs: isOptArr },
  },
  "customer.language": {
    owner: "voice",
    class: "lookup",
    freshnessMinutes: 1440,
    request: { window_days: isOptNum },
    // Aggregated + producer-side redacted before the bus write (Appendix B).
    response: { ...honestEmpty, themes: isOptArr, objections: isOptArr, sample_count: isOptNum },
  },
  "system.health": {
    owner: "sentinel",
    class: "lookup",
    freshnessMinutes: 15,
    request: { scope: isOptStr },
    response: { ...honestEmpty, connections: isOptArr, issues: isOptArr },
  },
};

// Appendix B: denylisted key names rejected anywhere in a payload (deep),
// defense in depth on top of schema-only payloads.
const DENYLISTED_KEYS = ["token", "secret", "password", "api_key", "authorization"];

const DEPARTMENTS = [
  "echo", "scout", "atlas", "nova", "pulse", "voice",
  "forge", "sentinel", "sage", "vision",
];

function getTopic(topic) {
  return TOPICS[topic] || null;
}

/** Validate a payload against a field->validator schema. Returns error string or null. */
function validatePayload(schema, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Payload must be an object.";
  }
  for (const [field, check] of Object.entries(schema)) {
    if (!check(payload[field])) return `Payload field "${field}" is missing or invalid.`;
  }
  for (const key of Object.keys(payload)) {
    if (!schema[key]) return `Payload field "${key}" is not allowed (schema-only payloads).`;
  }
  return null;
}

/** Deep scan for denylisted key names. Returns the offending key or null. */
function findDenylistedKey(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findDenylistedKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (DENYLISTED_KEYS.some((bad) => lower === bad || lower.includes(bad))) return key;
    const hit = findDenylistedKey(val, depth + 1);
    if (hit) return hit;
  }
  return null;
}

module.exports = {
  TOPICS,
  DEPARTMENTS,
  DENYLISTED_KEYS,
  getTopic,
  validatePayload,
  findDenylistedKey,
};
