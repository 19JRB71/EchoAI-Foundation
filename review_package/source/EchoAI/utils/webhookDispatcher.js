/**
 * Webhook dispatcher.
 *
 * Sends a JSON payload to a single webhook URL with bounded retries and a
 * per-attempt timeout, and records every attempt in webhook_delivery_logs. It
 * never throws — callers (the internal triggerWebhook fan-out) fire deliveries
 * without awaiting so the main request/response is never blocked by a slow or
 * dead webhook endpoint.
 *
 * The target URL is re-validated against the SSRF guardrail (https + non-private
 * resolved address) immediately before sending.
 */

const db = require("../config/db");
const { assertSafeWebhookTarget } = require("../config/webhooks");

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10000;
// Backoff before attempt N (index 1..MAX_ATTEMPTS-1 used).
const BACKOFF_MS = [0, 1000, 3000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logDelivery(webhookId, eventName, payload, status, success) {
  try {
    await db.query(
      `INSERT INTO webhook_delivery_logs
         (webhook_id, event_name, payload, response_status, success)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [webhookId, eventName, JSON.stringify(payload ?? null), status, success],
    );
  } catch (err) {
    console.error("Webhook delivery log insert failed:", err.message);
  }
}

/**
 * Delivers `payload` to `webhook.webhook_url`, retrying on failure. Logs each
 * attempt. Resolves to { success, status, error } and never rejects.
 */
async function deliver(webhook, eventName, payload) {
  let targetUrl;
  try {
    targetUrl = (await assertSafeWebhookTarget(webhook.webhook_url)).toString();
  } catch (err) {
    // Blocked target (SSRF guard / unresolvable) — record one failed attempt.
    await logDelivery(webhook.webhook_id, eventName, payload, null, false);
    return { success: false, status: null, error: err.message };
  }

  let status = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let success = false;
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Zorecho-Webhooks/1.0",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      success = res.ok;
    } catch (err) {
      status = null;
      success = false;
      lastError = err.name === "TimeoutError" ? "Request timed out" : err.message;
    }

    await logDelivery(webhook.webhook_id, eventName, payload, status, success);
    if (success) return { success: true, status };

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_MS[attempt] ?? 3000);
    }
  }

  return { success: false, status, error: lastError };
}

module.exports = { deliver };
