require("dotenv").config();

const twilio = require("twilio");
const { recordCommsUsage } = require("../utils/aiUsage");

/**
 * Twilio is connected PER BRAND (each business owner links their own Twilio
 * account + number in Settings), so there is no global Twilio API key. What we
 * DO need globally is a stable public base URL for the voice/status webhooks
 * Twilio calls back into.
 */

/**
 * Resolves the public base URL of this deployment (no trailing slash). Prefers
 * the stable Replit domain(s); falls back to the forwarded request host.
 * Overridable with PUBLIC_BASE_URL.
 */
function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    return `${proto}://${req.get("host")}`;
  }
  return null;
}

/**
 * Builds an authenticated Twilio REST client from a brand's stored credentials.
 *
 * The returned client is instrumented: every `messages.create` (SMS) and
 * `calls.create` (outbound voice) is recorded in the central usage ledger with
 * an estimated cost, the Twilio SID as provider_ref (for later reconciliation),
 * and whatever attribution `meta` the caller supplies ({ brandId, userId,
 * feature }). Ledger writes are fire-and-forget and NEVER block or fail the
 * actual send. Callers that don't pass meta still get workflow/job attribution
 * from the ambient AI context.
 */
function buildClient(accountSid, authToken, meta = {}) {
  const client = twilio(accountSid, authToken);
  instrument(client.messages, "create", (args, result, err, durationMs) => {
    const body = String((args && args[0] && args[0].body) || "");
    const segments = Math.max(1, Math.ceil(body.length / 153));
    recordCommsUsage({
      provider: "twilio",
      unitType: "sms_segment",
      unitQuantity: segments,
      feature: meta.feature || "sms_send",
      brandId: meta.brandId,
      userId: meta.userId,
      providerRef: result && result.sid ? result.sid : null,
      durationMs,
      success: !err,
      errorCategory: err ? "provider_error" : null,
      estimatedCostUsd: err ? 0 : undefined,
    });
  });
  instrument(client.calls, "create", (args, result, err, durationMs) => {
    // Duration isn't known at creation; estimate 1 minute now and let the
    // status webhook finalize the real minutes via provider_ref (Call SID).
    recordCommsUsage({
      provider: "twilio",
      unitType: "voice_minute",
      unitQuantity: 1,
      feature: meta.feature || "voice_call",
      brandId: meta.brandId,
      userId: meta.userId,
      providerRef: result && result.sid ? result.sid : null,
      durationMs,
      success: !err,
      errorCategory: err ? "provider_error" : null,
      estimatedCostUsd: err ? 0 : undefined,
    });
  });
  return client;
}

// Wraps an async method so `onDone` observes every call without ever altering
// the result or the error path.
function instrument(obj, method, onDone) {
  const original = obj[method].bind(obj);
  obj[method] = async (...args) => {
    const startedAt = Date.now();
    try {
      const result = await original(...args);
      try { onDone(args, result, null, Date.now() - startedAt); } catch {}
      return result;
    } catch (err) {
      try { onDone(args, null, err, Date.now() - startedAt); } catch {}
      throw err;
    }
  };
}

/**
 * Called by the phone status webhook when Twilio reports a completed call:
 * replaces the 1-minute placeholder estimate with the real billed minutes,
 * located by Call SID. Fire-and-forget; a miss is harmless (row keeps the
 * conservative 1-minute estimate).
 */
async function finalizeCallCost(callSid, callDurationSeconds, meta = {}) {
  try {
    const seconds = Number(callDurationSeconds);
    if (!callSid || !Number.isFinite(seconds) || seconds < 0) return;
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    const { COMM_UNIT_PRICES, recordCommsUsage: record } = require("../utils/aiUsage");
    const cost = Math.round(minutes * COMM_UNIT_PRICES["twilio:voice_minute"] * 1e6) / 1e6;
    const db = require("./db");
    const r = await db.query(
      `UPDATE ai_usage_log
          SET unit_quantity = $2,
              estimated_cost_usd = $3,
              duration_ms = $4
        WHERE provider = 'twilio' AND unit_type = 'voice_minute' AND provider_ref = $1`,
      [callSid, minutes, cost, seconds * 1000],
    );
    // Inbound calls never went through calls.create, so there is no row to
    // update — ledger them here instead so received AI-receptionist minutes
    // are counted too.
    if (r.rowCount === 0) {
      await record({
        provider: "twilio",
        unitType: "voice_minute",
        unitQuantity: minutes,
        feature: meta.feature || "voice_call_inbound",
        brandId: meta.brandId,
        userId: meta.userId,
        providerRef: callSid,
        durationMs: seconds * 1000,
        success: true,
      });
    }
  } catch (err) {
    console.error("twilio: failed to finalize call cost:", err.message);
  }
}

/**
 * Validates that an incoming request really came from Twilio using the brand's
 * auth token + the X-Twilio-Signature header. Returns true when valid.
 *
 * Set TWILIO_SKIP_VALIDATION=true to bypass (local testing only — never in prod).
 */
function validateTwilioRequest(req, authToken, fullUrl) {
  if (process.env.TWILIO_SKIP_VALIDATION === "true") return true;
  const signature = req.headers["x-twilio-signature"];
  if (!signature || !authToken) return false;
  try {
    return twilio.validateRequest(authToken, signature, fullUrl, req.body || {});
  } catch {
    return false;
  }
}

module.exports = { getPublicBaseUrl, buildClient, validateTwilioRequest, finalizeCallCost };
