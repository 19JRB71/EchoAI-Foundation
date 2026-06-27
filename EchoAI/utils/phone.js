/**
 * Phone number helpers shared across subsystems.
 */

/**
 * Normalizes a phone number to E.164 (leading "+" then digits). Storing a single
 * canonical form makes equality comparisons (lead dedup, inbound call routing)
 * deterministic regardless of how the number was typed. Returns null if it can't
 * produce a plausible number (7–15 digits per the E.164 spec).
 */
function normalizeE164(input) {
  if (!input) return null;
  const digits = String(input).trim().replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

module.exports = { normalizeE164 };
