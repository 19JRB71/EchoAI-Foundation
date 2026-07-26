/**
 * Firebase Cloud Messaging (FCM) configuration + low-level sender.
 *
 * Mirrors the graceful-degradation pattern of config/webpush.js: the feature is
 * gated on a single env var (FCM_SERVER_KEY). When it's unset, `isConfigured` is
 * false and `sendToTokens` no-ops — device-token registration still works, the
 * push just isn't delivered (so the rest of the app is unaffected).
 *
 * Uses the FCM HTTP API with the server key (Authorization: key=...). Node 24's
 * global `fetch` is used (no extra dependency). Returns which tokens are
 * permanently invalid so the caller can prune them.
 */

const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send";
const SERVER_KEY = process.env.FCM_SERVER_KEY;

// REPLIT_PROMPT_008 / Decision D-12: the legacy FCM endpoint above is RETIRED by
// Google — sends fail silently (counted, never delivered). Mobile push is
// therefore honestly disabled through GA. The HTTP v1 migration is post-GA.
// Rollback / re-enable path (not recommended): set FCM_LEGACY_ENABLED=true.
const LEGACY_ENABLED = process.env.FCM_LEGACY_ENABLED === "true";
const DISABLED_REASON = "legacy_endpoint_disabled";
const isConfigured = Boolean(SERVER_KEY) && LEGACY_ENABLED;

// ONE boot warning so operators know why mobile pushes stopped, then silence.
if (SERVER_KEY && !LEGACY_ENABLED) {
  console.warn(
    "[mobile-push] FCM_SERVER_KEY is set but mobile push is DISABLED: it targets " +
      "Google's retired legacy endpoint and cannot deliver (Decision D-12). " +
      `All sends no-op with { skipped: true, reason: '${DISABLED_REASON}' }.`
  );
}

/**
 * Send a notification to a batch of device tokens.
 *
 * @param {string[]} tokens   FCM registration tokens
 * @param {{title?:string, body?:string, data?:object}} payload
 * @returns {Promise<{sent:number, failed:number, invalidTokens:string[], skipped?:boolean}>}
 */
async function sendToTokens(tokens, payload = {}) {
  // Hard disable: no code path may reach the retired legacy endpoint.
  if (!LEGACY_ENABLED) {
    return { sent: 0, failed: 0, invalidTokens: [], skipped: true, reason: DISABLED_REASON };
  }
  if (!isConfigured) return { sent: 0, failed: 0, invalidTokens: [], skipped: true };
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  // FCM legacy accepts up to 1000 registration_ids per request.
  const batches = [];
  for (let i = 0; i < tokens.length; i += 1000) {
    batches.push(tokens.slice(i, i + 1000));
  }

  let sent = 0;
  let failed = 0;
  const invalidTokens = [];

  for (const batch of batches) {
    let res;
    try {
      res = await fetch(FCM_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `key=${SERVER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registration_ids: batch,
          notification: {
            title: payload.title || "Zorecho",
            body: payload.body || "",
          },
          data: payload.data || {},
          priority: "high",
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      // Network/timeout — count the whole batch as failed but don't throw.
      failed += batch.length;
      console.error("FCM send failed:", err.message);
      continue;
    }

    if (!res.ok) {
      failed += batch.length;
      console.error("FCM send non-2xx:", res.status);
      continue;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      sent += batch.length;
      continue;
    }

    // Map per-token results so we can prune permanently-dead tokens.
    const results = Array.isArray(json.results) ? json.results : [];
    results.forEach((result, idx) => {
      if (result.error) {
        failed += 1;
        if (
          result.error === "NotRegistered" ||
          result.error === "InvalidRegistration" ||
          result.error === "MismatchSenderId"
        ) {
          invalidTokens.push(batch[idx]);
        }
      } else {
        sent += 1;
      }
    });
  }

  return { sent, failed, invalidTokens };
}

module.exports = { isConfigured, sendToTokens, disabledReason: LEGACY_ENABLED ? null : DISABLED_REASON };
