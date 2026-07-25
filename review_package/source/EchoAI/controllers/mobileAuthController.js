/**
 * Mobile authentication controller (/api/v2/auth).
 *
 * Mobile sessions differ from the web in three ways:
 *   1. A long-lived (30-day) access JWT so the app rarely forces a re-login.
 *   2. A REFRESH token (opaque random string) for seamless re-authentication when
 *      the access token finally expires — only its SHA-256 hash is stored.
 *   3. A short-lived BIOMETRIC token the app keeps in the device secure enclave
 *      and exchanges (after a local Face ID / fingerprint check) for a fresh
 *      session, so the user never re-types a password.
 *
 * The 30-day access token is signed with the same JWT_SECRET and {userId,email}
 * shape as the web token, so it works with the shared `auth` middleware and every
 * existing protected route.
 */

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const { attributeSignup, readReferralCookie } = require("../utils/referralTracking");
const { success, fail } = require("../utils/mobileResponse");

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_TTL = "30d";
const BIOMETRIC_TOKEN_TTL = "5m";
const REFRESH_TOKEN_TTL_DAYS = 90;

/** Sign a 30-day mobile access token (same shape/secret as the web token). */
function signAccessToken(user) {
  return jwt.sign({ userId: user.user_id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

/** SHA-256 a raw refresh token for at-rest storage (never store the raw token). */
function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Create + persist a new refresh token for a user/device, returning the RAW token
 * (the caller hands it to the client; only the hash is stored).
 */
async function issueRefreshToken(userId, deviceId, deviceName) {
  const raw = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_id, device_name, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, deviceId || null, deviceName || null, expiresAt]
  );

  return { refreshToken: raw, refreshTokenExpiresAt: expiresAt };
}

function publicUser(user) {
  return {
    userId: user.user_id,
    email: user.email,
    subscriptionTier: user.subscription_tier,
  };
}

/**
 * POST /api/v2/auth/register
 * Creates an account (mirrors the web register flow, including affiliate
 * attribution) and returns a 30-day access token + a refresh token.
 */
async function register(req, res) {
  const { email, password, teamSize, referralCode, deviceId, deviceName } = req.body || {};

  if (!email || !password) {
    return fail(res, { status: 400, message: "Email and password are required" });
  }

  const client = await db.getClient();
  try {
    const existing = await client.query("SELECT user_id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return fail(res, { status: 409, message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await client.query("BEGIN");
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, subscription_tier, team_size)
       VALUES ($1, $2, 'free', $3)
       RETURNING user_id, email, subscription_tier`,
      [email, passwordHash, teamSize || 1]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO subscriptions (user_id, subscription_tier, billing_cycle, payment_status)
       VALUES ($1, 'free', 'monthly', 'active')`,
      [user.user_id]
    );
    await client.query("COMMIT");

    // Best-effort affiliate attribution (awaited after COMMIT, never fatal) — same
    // contract as the web register flow.
    const code = referralCode || readReferralCookie(req);
    if (code) {
      try {
        await attributeSignup(db, { referredUserId: user.user_id, code });
      } catch (err) {
        console.error("Referral attribution failed:", err.message);
      }
    }

    const token = signAccessToken(user);
    const { refreshToken, refreshTokenExpiresAt } = await issueRefreshToken(
      user.user_id,
      deviceId,
      deviceName
    );

    return success(res, {
      status: 201,
      message: "Account created",
      data: {
        token,
        refreshToken,
        refreshTokenExpiresAt,
        expiresIn: ACCESS_TOKEN_TTL,
        user: publicUser(user),
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Mobile register error:", err.message);
    return fail(res, { status: 500, message: "Failed to register" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/v2/auth/login
 * Verifies credentials and returns a 30-day access token + a refresh token.
 */
async function login(req, res) {
  const { email, password, deviceId, deviceName } = req.body || {};

  if (!email || !password) {
    return fail(res, { status: 400, message: "Email and password are required" });
  }

  try {
    const result = await db.query(
      "SELECT user_id, email, password_hash, subscription_tier FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return fail(res, { status: 401, message: "Invalid email or password" });
    }

    const user = result.rows[0];
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return fail(res, { status: 401, message: "Invalid email or password" });
    }

    const token = signAccessToken(user);
    const { refreshToken, refreshTokenExpiresAt } = await issueRefreshToken(
      user.user_id,
      deviceId,
      deviceName
    );

    return success(res, {
      message: "Logged in",
      data: {
        token,
        refreshToken,
        refreshTokenExpiresAt,
        expiresIn: ACCESS_TOKEN_TTL,
        user: publicUser(user),
      },
    });
  } catch (err) {
    console.error("Mobile login error:", err.message);
    return fail(res, { status: 500, message: "Failed to log in" });
  }
}

/**
 * POST /api/v2/auth/refresh
 * Exchanges a valid (unexpired) refresh token for a new access token. The refresh
 * token is ROTATED (single-use) — the old row is deleted and a new one issued — so
 * a stolen/leaked token can't be replayed after the next refresh.
 */
async function refresh(req, res) {
  const { refreshToken, deviceId, deviceName } = req.body || {};

  if (!refreshToken || typeof refreshToken !== "string") {
    return fail(res, { status: 400, message: "A refresh token is required" });
  }

  const tokenHash = hashToken(refreshToken);
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    // Lock + consume the row so two concurrent refreshes can't both rotate it.
    const found = await client.query(
      `SELECT rt.token_id, rt.user_id, rt.expires_at, rt.device_id, rt.device_name,
              u.email, u.subscription_tier
       FROM refresh_tokens rt
       JOIN users u ON u.user_id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [tokenHash]
    );

    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return fail(res, { status: 401, message: "Invalid refresh token" });
    }

    const row = found.rows[0];
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query("DELETE FROM refresh_tokens WHERE token_id = $1", [row.token_id]);
      await client.query("COMMIT");
      return fail(res, { status: 401, message: "Refresh token expired, please log in again" });
    }

    // Rotate: delete the consumed token and mint a fresh one.
    await client.query("DELETE FROM refresh_tokens WHERE token_id = $1", [row.token_id]);

    const raw = crypto.randomBytes(48).toString("hex");
    const newHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_id, device_name, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        row.user_id,
        newHash,
        deviceId || row.device_id || null,
        deviceName || row.device_name || null,
        expiresAt,
      ]
    );
    await client.query("COMMIT");

    const token = signAccessToken({
      user_id: row.user_id,
      email: row.email,
      subscription_tier: row.subscription_tier,
    });

    return success(res, {
      message: "Token refreshed",
      data: {
        token,
        refreshToken: raw,
        refreshTokenExpiresAt: expiresAt,
        expiresIn: ACCESS_TOKEN_TTL,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Mobile refresh error:", err.message);
    return fail(res, { status: 500, message: "Failed to refresh token" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/v2/auth/biometric  (protected)
 * Mints a short-lived biometric token (JWT with a `biometric` claim) while the
 * user has a valid session. The app stores it in the device secure enclave and,
 * after a successful Face ID / fingerprint check, exchanges it via
 * /biometric/login for a fresh 30-day session.
 */
function biometricToken(req, res) {
  const biometricToken = jwt.sign(
    { userId: req.user.userId, email: req.user.email, biometric: true },
    process.env.JWT_SECRET,
    { expiresIn: BIOMETRIC_TOKEN_TTL }
  );

  return success(res, {
    message: "Biometric token issued",
    data: { biometricToken, expiresIn: BIOMETRIC_TOKEN_TTL },
  });
}

/**
 * POST /api/v2/auth/biometric/login
 * Exchanges a valid biometric token (after the device's local Face ID /
 * fingerprint unlock) for a fresh access + refresh token. Rejects any token that
 * isn't a biometric token.
 */
async function biometricLogin(req, res) {
  const { biometricToken: incoming, deviceId, deviceName } = req.body || {};

  if (!incoming || typeof incoming !== "string") {
    return fail(res, { status: 400, message: "A biometric token is required" });
  }

  let decoded;
  try {
    decoded = jwt.verify(incoming, process.env.JWT_SECRET);
  } catch {
    return fail(res, { status: 401, message: "Invalid or expired biometric token" });
  }

  if (!decoded.biometric) {
    return fail(res, { status: 401, message: "Not a biometric token" });
  }

  try {
    const result = await db.query(
      "SELECT user_id, email, subscription_tier FROM users WHERE user_id = $1",
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      return fail(res, { status: 401, message: "Account no longer exists" });
    }

    const user = result.rows[0];
    const token = signAccessToken(user);
    const { refreshToken, refreshTokenExpiresAt } = await issueRefreshToken(
      user.user_id,
      deviceId,
      deviceName
    );

    return success(res, {
      message: "Logged in with biometrics",
      data: {
        token,
        refreshToken,
        refreshTokenExpiresAt,
        expiresIn: ACCESS_TOKEN_TTL,
        user: publicUser(user),
      },
    });
  } catch (err) {
    console.error("Biometric login error:", err.message);
    return fail(res, { status: 500, message: "Failed to log in with biometrics" });
  }
}

/**
 * POST /api/v2/auth/logout  (protected)
 * Revokes refresh tokens. With a `refreshToken` body, revokes just that device;
 * otherwise revokes every refresh token for the user (logout everywhere).
 */
async function logout(req, res) {
  const userId = req.user.userId;
  const { refreshToken } = req.body || {};

  try {
    if (refreshToken && typeof refreshToken === "string") {
      await db.query(
        "DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2",
        [userId, hashToken(refreshToken)]
      );
    } else {
      await db.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
    }
    return success(res, { message: "Logged out" });
  } catch (err) {
    console.error("Mobile logout error:", err.message);
    return fail(res, { status: 500, message: "Failed to log out" });
  }
}

module.exports = {
  register,
  login,
  refresh,
  biometricToken,
  biometricLogin,
  logout,
};
