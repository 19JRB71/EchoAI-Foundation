const jwt = require("jsonwebtoken");

/**
 * Signs a JWT for an authenticated user.
 * The secret and expiry are read from environment variables.
 */
function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
}

module.exports = { generateToken };
