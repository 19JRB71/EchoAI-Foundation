/**
 * Push-notification controller.
 *
 *  - saveSubscription: store a browser PushSubscription against the logged-in
 *    user (one row per device endpoint).
 *  - sendPushToUser: send a payload to every device a user has registered,
 *    pruning subscriptions the push service reports as gone (404/410).
 *  - getVapidPublicKey: expose the server's VAPID public key to the client so it
 *    can subscribe.
 *
 * sendPushToUser is exported for server-side callers (e.g. the hot-lead alert in
 * the chatbot controller) and is always best-effort: it never throws into its
 * caller and no-ops when push isn't configured.
 */

const db = require("../config/db");
const {
  webpush,
  isConfigured,
  publicKey,
  isAllowedPushEndpoint,
} = require("../config/webpush");

/** GET /api/push/vapid-public-key — the key the browser needs to subscribe. */
function getVapidPublicKey(req, res) {
  if (!isConfigured) {
    return res.status(503).json({ error: "Push notifications are not configured" });
  }
  return res.json({ publicKey });
}

/** POST /api/push/subscribe — persist a PushSubscription for this user. */
async function saveSubscription(req, res) {
  const userId = req.user.userId;
  const { subscription } = req.body || {};

  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    !subscription.keys ||
    typeof subscription.keys.p256dh !== "string" ||
    typeof subscription.keys.auth !== "string"
  ) {
    return res.status(400).json({ error: "A valid push subscription is required" });
  }

  // SSRF guardrail: only persist endpoints that point at a known browser push
  // service (the endpoint is later used as an outbound request target).
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    return res.status(400).json({ error: "Unsupported push endpoint" });
  }

  try {
    // Endpoint is globally unique per device/browser. Re-subscribing (or a
    // different user on the same device) updates ownership + keys.
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (endpoint)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     keys = EXCLUDED.keys,
                     updated_at = NOW()`,
      [userId, subscription.endpoint, JSON.stringify(subscription.keys)],
    );
    return res.status(201).json({ subscribed: true });
  } catch (err) {
    console.error("Save push subscription failed:", err.message);
    return res.status(500).json({ error: "Failed to save push subscription" });
  }
}

/**
 * Send a push notification to all of a user's registered devices.
 * @param {string} userId
 * @param {{title?:string, body?:string, url?:string, tag?:string}} payload
 * @returns {Promise<{sent:number, failed:number, skipped?:boolean}>}
 */
async function sendPushToUser(userId, payload) {
  if (!isConfigured) return { sent: 0, failed: 0, skipped: true };

  let subs;
  try {
    const result = await db.query(
      "SELECT subscription_id, endpoint, keys FROM push_subscriptions WHERE user_id = $1",
      [userId],
    );
    subs = result.rows;
  } catch (err) {
    console.error("Load push subscriptions failed:", err.message);
    return { sent: 0, failed: 0 };
  }

  if (subs.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload || {});
  let sent = 0;
  let failed = 0;
  const stale = [];

  await Promise.all(
    subs.map(async (row) => {
      // Defense in depth: never make an outbound request to an endpoint that is
      // no longer on the allowlist — treat it as stale and prune it.
      if (!isAllowedPushEndpoint(row.endpoint)) {
        failed += 1;
        stale.push(row.subscription_id);
        return;
      }
      const subscription = { endpoint: row.endpoint, keys: row.keys };
      try {
        await webpush.sendNotification(subscription, body, { TTL: 3600, timeout: 8000 });
        sent += 1;
      } catch (err) {
        failed += 1;
        // 404/410 mean the subscription is permanently gone — prune it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          stale.push(row.subscription_id);
        } else {
          console.error("Push send failed:", err.statusCode || err.message);
        }
      }
    }),
  );

  if (stale.length > 0) {
    try {
      await db.query(
        "DELETE FROM push_subscriptions WHERE subscription_id = ANY($1::uuid[])",
        [stale],
      );
    } catch (err) {
      console.error("Prune stale subscriptions failed:", err.message);
    }
  }

  return { sent, failed };
}

module.exports = { getVapidPublicKey, saveSubscription, sendPushToUser };
