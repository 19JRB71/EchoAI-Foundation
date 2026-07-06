/**
 * Shared "your scheduled send failed" owner alert used by every background
 * sender (social posts, email drips, SMS blasts). One place implements the
 * invariants the per-channel callers rely on:
 *
 *  - Best-effort: never throws into a scheduler loop or request handler.
 *  - Demo brands never alert (the failed state flip still happens upstream).
 *  - Callers only invoke this where the atomic -> 'failed' transition really
 *    hit a row, and the per-item notification `tag` collapses any duplicate
 *    deliveries at the notification tray.
 *  - Web push to every installed device + FCM mirror to native mobile devices
 *    (mirrors the hot-lead alert pattern).
 */

const db = require("../config/db");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");

/**
 * Sends the owner of `brandId` a failure alert.
 *
 * @param {object} opts
 * @param {string} opts.brandId    brand whose owner should be alerted
 * @param {string} opts.title      push title (e.g. "⚠️ Post failed to publish")
 * @param {function} opts.buildBody (brand) => body string; receives the brands
 *                                 row ({ brand_name, user_id, is_demo })
 * @param {string} opts.url        dashboard deep link (/dashboard?section=...)
 * @param {string} opts.tag        per-item notification tag (dedup backstop)
 * @param {object} [opts.mobileData] FCM data payload (string values)
 * @param {string} [opts.logLabel] label used in error logs
 */
async function alertOwnerOfFailedSend({
  brandId,
  title,
  buildBody,
  url,
  tag,
  mobileData,
  logLabel = "Failed-send",
}) {
  try {
    const { rows } = await db.query(
      "SELECT brand_name, user_id, is_demo FROM brands WHERE brand_id = $1",
      [brandId]
    );
    const brand = rows[0];
    if (!brand || brand.is_demo || !brand.user_id) return;

    const body = buildBody(brand);

    await pushController
      .sendPushToUser(brand.user_id, { title, body, url, tag })
      .catch((err) =>
        console.error(`${logLabel} push alert failed:`, err.message)
      );

    // Mirror to the owner's native mobile devices (no-ops without tokens).
    await mobilePushController
      .sendToUser(brand.user_id, { title, body, data: mobileData || {} })
      .catch((err) =>
        console.error(`${logLabel} mobile push alert failed:`, err.message)
      );
  } catch (err) {
    console.error(`${logLabel} alert lookup failed for brand ${brandId}:`, err.message);
  }
}

module.exports = { alertOwnerOfFailedSend };
