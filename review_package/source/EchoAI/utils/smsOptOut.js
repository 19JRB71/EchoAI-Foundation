/**
 * Platform-wide SMS opt-out helpers.
 *
 * Opt-outs are stored per (brand, phone number) in `sms_opt_outs`. EVERY outbound
 * SMS send across the entire platform (campaigns, follow-up sequences, appointment
 * reminders, survey invitations, auto-replies) MUST call `isOptedOut` before
 * sending so an opted-out number never receives another message from any feature.
 *
 * Numbers are normalized to E.164 before storage/lookup so equality is
 * deterministic regardless of how the number was typed.
 */

const db = require("../config/db");
const { normalizeE164 } = require("./phone");

/** Canonical form used for opt-out storage + comparison. Falls back to a trimmed
 * digit string when the input can't be normalized to E.164. */
function canonical(phone) {
  return normalizeE164(phone) || String(phone || "").trim();
}

/** True when `phone` has opted out of SMS for `brandId`. */
async function isOptedOut(brandId, phone) {
  if (!brandId || !phone) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM sms_opt_outs WHERE brand_id = $1 AND phone_number = $2 LIMIT 1`,
    [brandId, canonical(phone)],
  );
  return rows.length > 0;
}

/** Records an opt-out (idempotent). Returns the canonical number stored. */
async function recordOptOut(brandId, phone) {
  const number = canonical(phone);
  await db.query(
    `INSERT INTO sms_opt_outs (brand_id, phone_number)
     VALUES ($1, $2)
     ON CONFLICT (brand_id, phone_number) DO NOTHING`,
    [brandId, number],
  );
  return number;
}

/** Removes an opt-out (manual re-subscribe / START keyword). */
async function removeOptOut(brandId, phone) {
  await db.query(
    `DELETE FROM sms_opt_outs WHERE brand_id = $1 AND phone_number = $2`,
    [brandId, canonical(phone)],
  );
}

module.exports = { isOptedOut, recordOptOut, removeOptOut, canonical };
