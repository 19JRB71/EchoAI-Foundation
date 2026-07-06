const jwt = require("jsonwebtoken");

// Permanent login: a "remember this device" token lives for 30 days so Echo is
// already signed in whenever the owner opens EchoAI on their regular device.
// When the user opts out of remembering the device we issue a short-lived token
// AND the client keeps it in sessionStorage, so it disappears when the browser
// closes.
const REMEMBER_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const SESSION_EXPIRES_IN = process.env.JWT_SESSION_EXPIRES_IN || "12h";

/**
 * Signs a JWT for an authenticated user. Pass `rememberDevice: false` to issue a
 * short-lived (browser-session) token; the default is a 30-day persistent token.
 * The secret and expiry windows are read from environment variables.
 */
function generateToken(payload, { rememberDevice = true } = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: rememberDevice ? REMEMBER_EXPIRES_IN : SESSION_EXPIRES_IN,
  });
}

module.exports = { generateToken, REMEMBER_EXPIRES_IN, SESSION_EXPIRES_IN };
