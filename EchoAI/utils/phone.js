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

/**
 * Masks a phone number for sales reps so they can recognize a lead without ever
 * seeing enough digits to redial or exfiltrate the contact. Keeps only the first
 * three and last two digits; everything in between becomes X. Returns a short
 * placeholder for anything too short to mask meaningfully.
 *
 *   "+1 (352) 456-1008"  ->  "135-XXXXX-08"
 */
function maskPhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length < 5) return "•••";
  const first = digits.slice(0, 3);
  const last = digits.slice(-2);
  const middle = "X".repeat(Math.max(1, digits.length - 5));
  return `${first}-${middle}-${last}`;
}

module.exports = { normalizeE164, maskPhone };
