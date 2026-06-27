require("dotenv").config();

const twilio = require("twilio");

/**
 * Twilio is connected PER BRAND (each business owner links their own Twilio
 * account + number in Settings), so there is no global Twilio API key. What we
 * DO need globally is a stable public base URL for the voice/status webhooks
 * Twilio calls back into.
 */

/**
 * Resolves the public base URL of this deployment (no trailing slash). Prefers
 * the stable Replit domain(s); falls back to the forwarded request host.
 * Overridable with PUBLIC_BASE_URL.
 */
function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    return `${proto}://${req.get("host")}`;
  }
  return null;
}

/** Builds an authenticated Twilio REST client from a brand's stored credentials. */
function buildClient(accountSid, authToken) {
  return twilio(accountSid, authToken);
}

/**
 * Validates that an incoming request really came from Twilio using the brand's
 * auth token + the X-Twilio-Signature header. Returns true when valid.
 *
 * Set TWILIO_SKIP_VALIDATION=true to bypass (local testing only — never in prod).
 */
function validateTwilioRequest(req, authToken, fullUrl) {
  if (process.env.TWILIO_SKIP_VALIDATION === "true") return true;
  const signature = req.headers["x-twilio-signature"];
  if (!signature || !authToken) return false;
  try {
    return twilio.validateRequest(authToken, signature, fullUrl, req.body || {});
  } catch {
    return false;
  }
}

module.exports = { getPublicBaseUrl, buildClient, validateTwilioRequest };
