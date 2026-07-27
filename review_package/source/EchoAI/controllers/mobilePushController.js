/**
 * Mobile push-notification controller (FCM).
 *
 *  - registerDeviceToken: store/refresh a device's FCM token for the logged-in
 *    user (one row per push_token).
 *  - unregisterDeviceToken: remove a token on logout / opt-out.
 *  - sendToUser: push a notification to every device a user has registered,
 *    pruning tokens FCM reports as permanently invalid.
 *
 * sendToUser is exported for server-side callers (hot-lead alerts, weekly
 * reports, payment-failed events) and is ALWAYS best-effort: it never throws into
 * its caller and no-ops when FCM isn't configured.
 */

const db = require("../config/db");
const fcm = require("../config/fcm");
const { success, fail } = require("../utils/mobileResponse");

const VALID_PLATFORMS = ["ios", "android", "web"];

/** POST /api/v2/push/register — persist an FCM device token for this user. */
async function registerDeviceToken(req, res) {
  const userId = req.user.userId;
  const { pushToken, platform, deviceId, deviceName } = req.body || {};

  if (!pushToken || typeof pushToken !== "string") {
    return fail(res, { status: 400, message: "A valid pushToken is required" });
  }

  const normalizedPlatform = VALID_PLATFORMS.includes(platform) ? platform : "android";

  try {
    // push_token is globally unique per device. Re-registering (or a different
    // user on the same device) updates ownership + metadata.
    const result = await db.query(
      `INSERT INTO device_tokens (user_id, push_token, platform, device_id, device_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (push_token)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     platform = EXCLUDED.platform,
                     device_id = EXCLUDED.device_id,
                     device_name = EXCLUDED.device_name,
                     updated_at = NOW()
       RETURNING device_token_id, platform, created_at`,
      [userId, pushToken, normalizedPlatform, deviceId || null, deviceName || null]
    );

    return success(res, {
      status: 201,
      message: "Device registered for push notifications",
      data: {
        deviceTokenId: result.rows[0].device_token_id,
        platform: result.rows[0].platform,
        pushConfigured: fcm.isConfigured,
      },
    });
  } catch (err) {
    console.error("Register device token failed:", err.message);
    return fail(res, { status: 500, message: "Failed to register device token" });
  }
}

/** DELETE /api/v2/push/register — remove an FCM device token. */
async function unregisterDeviceToken(req, res) {
  const userId = req.user.userId;
  const { pushToken } = req.body || {};

  if (!pushToken || typeof pushToken !== "string") {
    return fail(res, { status: 400, message: "A valid pushToken is required" });
  }

  try {
    await db.query(
      "DELETE FROM device_tokens WHERE push_token = $1 AND user_id = $2",
      [pushToken, userId]
    );
    return success(res, { message: "Device unregistered" });
  } catch (err) {
    console.error("Unregister device token failed:", err.message);
    return fail(res, { status: 500, message: "Failed to unregister device token" });
  }
}

/**
 * Send a push notification to all of a user's registered mobile devices via FCM.
 * Best-effort: never throws, no-ops when FCM isn't configured.
 *
 * @param {string} userId
 * @param {{title?:string, body?:string, data?:object}} payload
 * @returns {Promise<{sent:number, failed:number, skipped?:boolean}>}
 */
async function sendToUser(userId, payload) {
  if (!fcm.isConfigured) return { sent: 0, failed: 0, skipped: true };

  let tokens;
  try {
    const result = await db.query(
      "SELECT push_token FROM device_tokens WHERE user_id = $1",
      [userId]
    );
    tokens = result.rows.map((r) => r.push_token);
  } catch (err) {
    console.error("Load device tokens failed:", err.message);
    return { sent: 0, failed: 0 };
  }

  if (tokens.length === 0) return { sent: 0, failed: 0 };

  let outcome;
  try {
    outcome = await fcm.sendToTokens(tokens, payload || {});
  } catch (err) {
    console.error("FCM dispatch failed:", err.message);
    return { sent: 0, failed: tokens.length };
  }

  // Prune tokens FCM reports as permanently invalid.
  if (outcome.invalidTokens && outcome.invalidTokens.length > 0) {
    try {
      await db.query("DELETE FROM device_tokens WHERE push_token = ANY($1::text[])", [
        outcome.invalidTokens,
      ]);
    } catch (err) {
      console.error("Prune invalid device tokens failed:", err.message);
    }
  }

  return { sent: outcome.sent, failed: outcome.failed };
}

module.exports = { registerDeviceToken, unregisterDeviceToken, sendToUser };
