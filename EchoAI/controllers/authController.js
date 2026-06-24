const bcrypt = require("bcrypt");

const db = require("../config/db");
const { generateToken } = require("../utils/token");

const SALT_ROUNDS = 10;

/**
 * POST /register
 * Accepts email, password, and team size. Hashes the password, creates a user
 * record and a default free subscription (in a single transaction), and returns
 * a JWT token.
 */
async function register(req, res) {
  const { email, password, teamSize } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const client = await db.getClient();

  try {
    const existing = await client.query("SELECT user_id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await client.query("BEGIN");

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, subscription_tier, team_size)
       VALUES ($1, $2, 'free', $3)
       RETURNING user_id, email, subscription_tier, team_size, created_at`,
      [email, passwordHash, teamSize || 1]
    );

    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO subscriptions (user_id, subscription_tier, billing_cycle, payment_status)
       VALUES ($1, 'free', 'monthly', 'active')`,
      [user.user_id]
    );

    await client.query("COMMIT");

    const token = generateToken({ userId: user.user_id, email: user.email });

    return res.status(201).json({
      token,
      user: {
        userId: user.user_id,
        email: user.email,
        subscriptionTier: user.subscription_tier,
        teamSize: user.team_size,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Register error:", err);
    return res.status(500).json({ error: "Failed to register user" });
  } finally {
    client.release();
  }
}

/**
 * POST /login
 * Accepts email and password, verifies the password against the stored hash,
 * and returns a JWT token on success.
 */
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await db.query(
      "SELECT user_id, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken({ userId: user.user_id, email: user.email });

    return res.json({
      token,
      user: { userId: user.user_id, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Failed to log in" });
  }
}

/**
 * GET /profile  (protected)
 * Returns the current user's account details, including subscription tier and
 * team size.
 */
async function getProfile(req, res) {
  try {
    const result = await db.query(
      `SELECT user_id, email, subscription_tier, team_size, created_at, updated_at
       FROM users
       WHERE user_id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    return res.json({
      userId: user.user_id,
      email: user.email,
      subscriptionTier: user.subscription_tier,
      teamSize: user.team_size,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    });
  } catch (err) {
    console.error("Get profile error:", err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
}

/**
 * PUT /profile  (protected)
 * Allows the current user to update their account information (email and/or
 * team size). Only provided fields are updated.
 */
async function updateProfile(req, res) {
  const { email, teamSize } = req.body;

  if (email === undefined && teamSize === undefined) {
    return res.status(400).json({ error: "No fields provided to update" });
  }

  const fields = [];
  const values = [];
  let idx = 1;

  if (email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(email);
  }
  if (teamSize !== undefined) {
    fields.push(`team_size = $${idx++}`);
    values.push(teamSize);
  }

  values.push(req.user.userId);

  try {
    const result = await db.query(
      `UPDATE users
       SET ${fields.join(", ")}
       WHERE user_id = $${idx}
       RETURNING user_id, email, subscription_tier, team_size, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    return res.json({
      userId: user.user_id,
      email: user.email,
      subscriptionTier: user.subscription_tier,
      teamSize: user.team_size,
      updatedAt: user.updated_at,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That email is already in use" });
    }
    console.error("Update profile error:", err);
    return res.status(500).json({ error: "Failed to update profile" });
  }
}

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
};
