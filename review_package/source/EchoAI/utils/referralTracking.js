// Affiliate referral tracking helpers: generating shareable referral codes,
// persisting a visitor's referral code in a cookie, and attributing a new
// signup to the referring affiliate.

const crypto = require("crypto");

// Cookie name holding a visitor's pending referral code until they sign up.
const REFERRAL_COOKIE = "echoai_ref";

// 30 days — long enough to cover the gap between clicking a referral link and
// actually creating an account.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Codes are uppercase and 6-12 chars. Generated codes use an unambiguous
// alphabet (no 0/O/1/I/L) so they're easy to read and share by hand.
const REFERRAL_CODE_RE = /^[A-Z0-9]{6,12}$/;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** Generates a random, hard-to-guess referral code. */
function generateReferralCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Upper-cases and trims a client-supplied code into its canonical form. */
function normalizeReferralCode(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function isValidReferralCode(code) {
  return REFERRAL_CODE_RE.test(normalizeReferralCode(code));
}

/**
 * Stores the referral code in an httpOnly cookie so a later signup (which may
 * happen on a different page load) can be attributed server-side. res.cookie is
 * provided by Express without cookie-parser; only *reading* needs manual parsing.
 */
function setReferralCookie(res, code) {
  res.cookie(REFERRAL_COOKIE, normalizeReferralCode(code), {
    maxAge: COOKIE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/**
 * Reads the referral cookie from the raw Cookie header. cookie-parser is not
 * installed, so the header is parsed by hand. Returns "" when absent.
 */
function readReferralCookie(req) {
  const header = req.headers && req.headers.cookie;
  if (!header) return "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === REFERRAL_COOKIE) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

/**
 * Attributes a new signup to an affiliate referral. Creates a pending referral
 * row (commission 0) so the signup is tracked immediately; the commission is
 * filled in later on the referred user's first payment.
 *
 * Best-effort and idempotent: no-op when the code is missing/invalid, doesn't
 * map to an *active* affiliate, the affiliate is referring themselves, or the
 * user was already attributed (UNIQUE referred_user_id + ON CONFLICT DO NOTHING).
 *
 * `client` may be a pool or a checked-out client — only `.query` is used.
 * Returns true when a referral row was created.
 */
async function attributeSignup(client, { referredUserId, code }) {
  const normalized = normalizeReferralCode(code);
  if (!referredUserId || !isValidReferralCode(normalized)) return false;

  const { rows } = await client.query(
    `SELECT affiliate_id, user_id FROM affiliates
     WHERE referral_code = $1 AND status = 'active'`,
    [normalized]
  );
  const affiliate = rows[0];
  if (!affiliate) return false;
  if (affiliate.user_id === referredUserId) return false; // can't refer yourself

  const inserted = await client.query(
    `INSERT INTO referrals (affiliate_id, referred_user_id, referral_code_used)
     VALUES ($1, $2, $3)
     ON CONFLICT (referred_user_id) DO NOTHING
     RETURNING referral_id`,
    [affiliate.affiliate_id, referredUserId, normalized]
  );
  return inserted.rows.length > 0;
}

module.exports = {
  REFERRAL_COOKIE,
  generateReferralCode,
  normalizeReferralCode,
  isValidReferralCode,
  setReferralCookie,
  readReferralCookie,
  attributeSignup,
};
