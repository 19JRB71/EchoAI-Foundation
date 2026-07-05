/**
 * Shared helper for enqueueing spoken events into `echo_voice_notifications`.
 *
 * Both the scheduler (time-driven reminders) and the feature controllers
 * (event-driven alerts) call `enqueueVoiceNotification`. It is:
 *  - idempotent: a `dedupKey` maps to the unique index (user_id, dedup_key) and
 *    `ON CONFLICT DO NOTHING` makes overlapping scheduler ticks safe.
 *  - best-effort: it never throws. Voice is an assistive layer, so a failure to
 *    enqueue must never break the lead/appointment/health flow that triggered it.
 */
const db = require("../config/db");
const { toJsonbParam } = require("./jsonb");
const { normalizeSettings } = require("../config/echoVoice");

/**
 * @param {object} opts
 * @param {string} opts.userId       owner (workspace) user id to speak to.
 * @param {string} [opts.brandId]    originating brand, if any.
 * @param {string} opts.eventType    one of config/echoVoice EVENT_TYPES.
 * @param {string} opts.spokenText   the exact line Echo will say (deterministic).
 * @param {string} [opts.title]      short label for UI/logging.
 * @param {object} [opts.payload]    structured extras (contact details, actions).
 * @param {string} [opts.dedupKey]   idempotency key (unique per user).
 * @param {Date}   [opts.deliverAfter] earliest time to surface (default now).
 * @param {Date}   [opts.expiresAt]  latest time to surface (default null = never).
 * @returns {Promise<string|null>} the new notification id, or null if a duplicate
 *   or a (swallowed) failure.
 */
async function enqueueVoiceNotification(opts) {
  const {
    userId,
    brandId = null,
    eventType,
    spokenText,
    title = null,
    payload = null,
    dedupKey = null,
    deliverAfter = null,
    expiresAt = null,
  } = opts || {};

  if (!userId || !eventType || !spokenText) return null;

  try {
    const result = await db.query(
      `INSERT INTO echo_voice_notifications
         (user_id, brand_id, event_type, title, spoken_text, payload,
          dedup_key, deliver_after, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9)
       ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL
       DO NOTHING
       RETURNING notification_id`,
      [
        userId,
        brandId,
        eventType,
        title,
        spokenText,
        toJsonbParam(payload),
        dedupKey,
        deliverAfter,
        expiresAt,
      ]
    );
    return result.rows[0] ? result.rows[0].notification_id : null;
  } catch (err) {
    console.error("enqueueVoiceNotification failed:", err.message);
    return null;
  }
}

/**
 * Convenience wrapper for EVENT-driven alerts (hot lead, low budget, Sentinel
 * fix, rep completed). Resolves the owner's first name + voice settings, honors
 * the enabled + per-event toggle gate, then enqueues. `buildText(firstName)`
 * returns the exact spoken line. Best-effort — never throws into the caller's
 * flow (chat, health sweep, CRM completion, etc.).
 *
 * @param {string} userId
 * @param {string} eventType  one of config/echoVoice EVENT_TYPES.
 * @param {(firstName: string) => string} buildText
 * @param {object} [opts]  passed through to enqueueVoiceNotification (brandId,
 *   title, payload, dedupKey, expiresAt, deliverAfter).
 */
async function enqueueOwnerVoiceEvent(userId, eventType, buildText, opts = {}) {
  if (!userId || typeof buildText !== "function") return null;
  try {
    const r = await db.query(
      "SELECT first_name, voice_settings FROM users WHERE user_id = $1",
      [userId]
    );
    const u = r.rows[0];
    if (!u) return null;
    const settings = normalizeSettings(u.voice_settings);
    if (!settings.enabled) return null;
    if (settings.events[eventType] === false) return null;
    const firstName = u.first_name && u.first_name.trim() ? u.first_name.trim() : "there";
    const spokenText = buildText(firstName);
    if (!spokenText) return null;
    return enqueueVoiceNotification({ userId, eventType, spokenText, ...opts });
  } catch (err) {
    console.error("enqueueOwnerVoiceEvent failed:", err.message);
    return null;
  }
}

module.exports = { enqueueVoiceNotification, enqueueOwnerVoiceEvent };
