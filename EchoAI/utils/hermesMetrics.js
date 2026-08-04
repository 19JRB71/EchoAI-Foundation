// Hermes decision telemetry (Prompt 021 — Owner Addendum §11, Stage-2 §2/§4/§5).
//
// PURELY OBSERVATIONAL. The recorder must never change Hermes behavior:
//   - it never throws (every failure is swallowed and logged),
//   - it is never awaited on the caller's hot path (fire-and-forget),
//   - it adds no retries and touches no timeout,
//   - persistence failure = the measurement is simply missing (reported
//     honestly by the dashboard as a gap, never reconstructed/guessed).
//
// Exactly-once guarantee (Stage-2 §5): each wrapper generates ONE
// invocation_id per invocation and calls the recorder exactly once, after
// final classification. The INSERT is a single statement with
// ON CONFLICT (invocation_id) DO NOTHING — no row before classification,
// at most one durable row after it, no duplicate, no key regeneration.

const crypto = require("crypto");
const db = require("../config/db");
const { ENVIRONMENT } = require("../config/environment");

/** One stable identifier per Hermes invocation (generated in the wrapper). */
function newInvocationId() {
  return crypto.randomUUID();
}

/**
 * Classify a createCompletion() failure into the fixed outcome vocabulary.
 *   - AI-gate rejection (assertAiAllowed threw before any request) → suppressed
 *   - per-attempt timeout (AbortError)                             → timeout
 *   - everything else                                              → error
 */
function classifyHermesFailure(err) {
  if (err && err.aiBlocked === true) return "suppressed";
  const name = String((err && err.name) || "");
  if (/Abort/i.test(name)) return "timeout";
  if (err && typeof err.message === "string" && /aborted/i.test(err.message) && name === "TypeError") {
    // fetch() in some runtimes surfaces aborts as TypeError("...aborted...").
    return "timeout";
  }
  return "error";
}

const OUTCOMES = new Set(["non_null", "null", "error", "timeout", "suppressed"]);

/**
 * Record one classified Hermes decision. Fire-and-forget: returns a promise
 * that ALWAYS resolves (never rejects), so callers may invoke it without
 * await and without a .catch. Any DB failure is logged and dropped —
 * the Hermes call's behavior and return value are never affected.
 */
async function recordHermesDecision({ invocationId, feature, brandId, outcome, latencyMs }) {
  try {
    if (!invocationId || !OUTCOMES.has(outcome)) {
      console.warn("hermesMetrics: dropping malformed decision record", { invocationId, outcome });
      return;
    }
    await db.query(
      `INSERT INTO hermes_decisions (invocation_id, environment, feature, brand_id, outcome, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (invocation_id) DO NOTHING`,
      [
        invocationId,
        ENVIRONMENT || "unknown",
        String(feature || "unknown").slice(0, 100),
        brandId || null,
        outcome,
        Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null,
      ],
    );
  } catch (err) {
    // Missing measurement is acceptable; altered Hermes behavior is not.
    console.warn("hermesMetrics: decision record failed (measurement dropped):", err.message);
  }
}

module.exports = { newInvocationId, classifyHermesFailure, recordHermesDecision };
