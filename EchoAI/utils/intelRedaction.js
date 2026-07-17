/**
 * Ingestion-layer PII redaction for the canonical intelligence store (W8).
 *
 * Every intel item passes through redactItemFields() inside the single
 * saveIntelItem chokepoint (utils/intelStore.js), so no collector can bypass
 * it. Deterministic, code-enforced — never AI. The rules deliberately target
 * machine-recognizable PII (emails, phone numbers) rather than trying to
 * guess names from prose: name-level privacy is handled by the `sensitive`
 * flag (conversation-derived items are owner-only and never aggregated).
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone numbers: 7+ digit runs with common separators, incl. +1 style prefixes.
// Requires a digit-ish start boundary so prices/years ($12,000 / 2026) survive.
const PHONE_RE = /(?:(?<=^)|(?<=[\s(:;,]))\+?\d[\d\s().-]{6,}\d(?=$|[\s).:;,!?])/g;

function looksLikePhone(candidate) {
  const digits = candidate.replace(/\D/g, "");
  // 7–15 digits is the plausible phone range (E.164 max 15). Fewer digits are
  // prices/ids; more are hashes. Also reject pure years/amount patterns.
  return digits.length >= 7 && digits.length <= 15;
}

function redactText(text) {
  if (!text || typeof text !== "string") return { text, redacted: false };
  let redacted = false;
  let out = text.replace(EMAIL_RE, () => {
    redacted = true;
    return "[email removed]";
  });
  out = out.replace(PHONE_RE, (m) => {
    if (!looksLikePhone(m)) return m;
    redacted = true;
    return "[phone removed]";
  });
  return { text: out, redacted };
}

/**
 * Redact the free-text fields of an intel item in place-safe fashion.
 * Returns { item, redacted } — item is a shallow copy with cleaned fields.
 */
function redactItemFields(item) {
  const copy = { ...item };
  let any = false;
  for (const field of ["summary", "why_it_matters", "source_title"]) {
    const r = redactText(copy[field]);
    if (r.redacted) any = true;
    copy[field] = r.text;
  }
  return { item: copy, redacted: any };
}

module.exports = { redactText, redactItemFields };
