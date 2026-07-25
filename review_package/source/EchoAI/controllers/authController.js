const bcrypt = require("bcrypt");

const db = require("../config/db");
const { generateToken } = require("../utils/token");
const emailController = require("./emailController");
const { attributeSignup, readReferralCookie } = require("../utils/referralTracking");
const { getBetaSettings, countUsedSlots } = require("../utils/betaProgram");
const { normalizeE164 } = require("../utils/phone");

const SALT_ROUNDS = 10;

/**
 * Free test mode — when FREE_TEST_MODE=true, new signups get full Enterprise
 * access with no payment, and the onboarding wizard skips the payment step.
 * Flip the env var off to restore normal paid signups (existing test accounts
 * keep their tier until an admin changes it).
 */
function freeTestModeEnabled() {
  return String(process.env.FREE_TEST_MODE || "").toLowerCase() === "true";
}

/**
 * GET /signup-mode (public)
 * Lets the client know whether free test mode is on so the onboarding wizard
 * can skip the Stripe payment step, and whether the beta program is at
 * capacity so the signup page can show the waitlist instead. Never exposes
 * anything sensitive — just two booleans.
 */
async function signupMode(req, res) {
  const freeTestMode = freeTestModeEnabled();
  let betaFull = false;
  if (freeTestMode) {
    try {
      const settings = await getBetaSettings();
      const used = await countUsedSlots();
      betaFull = used >= settings.max_slots;
    } catch (err) {
      // Fail open (allow signup attempts) — register() re-checks atomically.
      console.error("signupMode beta capacity check failed:", err.message);
    }
  }
  return res.json({ freeTestMode, betaFull });
}

/**
 * POST /waitlist (public)
 * Adds an email to the beta waitlist. Always answers with the same success
 * message so it can't be used to probe which emails are already listed.
 */
async function joinWaitlist(req, res) {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    return res.status(400).json({ error: "A valid email address is required" });
  }
  try {
    await db.query(
      `INSERT INTO beta_waitlist (email) VALUES ($1)
       ON CONFLICT (email) DO NOTHING`,
      [email]
    );
    return res.json({
      message: "You're on the list! We'll email you when a beta spot opens up.",
    });
  } catch (err) {
    console.error("joinWaitlist error:", err);
    return res.status(500).json({ error: "Failed to join the waitlist" });
  }
}

/**
 * POST /register
 * Accepts email, password, and team size. Hashes the password, creates a user
 * record and a default free subscription (in a single transaction), and returns
 * a JWT token.
 */
async function register(req, res) {
  const { email, password, teamSize, referralCode, rememberDevice } = req.body;

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

    // In free test mode new accounts get full Enterprise access, no payment —
    // these are BETA accounts, capped by the admin's beta slot limit. The
    // settings row is locked FOR UPDATE so two concurrent signups can't both
    // grab the last slot.
    const isBetaSignup = freeTestModeEnabled();
    if (isBetaSignup) {
      await client.query("SELECT max_slots FROM beta_settings WHERE id = 1 FOR UPDATE");
      const settings = await getBetaSettings(client);
      const used = await countUsedSlots(client);
      if (used >= settings.max_slots) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error:
            "We're currently at capacity for our beta program. Enter your email to be notified when spots open up.",
          waitlistOpen: true,
        });
      }
    }
    const signupTier = isBetaSignup ? "enterprise" : "free";

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, subscription_tier, team_size, is_beta)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, email, subscription_tier, team_size, created_at`,
      [email, passwordHash, signupTier, teamSize || 1, isBetaSignup]
    );

    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO subscriptions (user_id, subscription_tier, billing_cycle, payment_status)
       VALUES ($1, $2, 'monthly', 'active')`,
      [user.user_id, signupTier]
    );

    await client.query("COMMIT");

    // Attribute the signup to an affiliate referral if a code was supplied in
    // the request body (client localStorage) or stored in the referral cookie.
    // Awaited (after COMMIT) so the referral row exists BEFORE the token is
    // returned — the user can't reach checkout/pay until they're logged in, so
    // this guarantees the first-payment webhook finds the row to convert. Errors
    // are swallowed so a bad code never fails an otherwise-successful signup.
    const code = referralCode || readReferralCookie(req);
    if (code) {
      try {
        await attributeSignup(db, { referredUserId: user.user_id, code });
      } catch (err) {
        console.error("Referral attribution failed:", err.message);
      }
    }

    const token = generateToken(
      { userId: user.user_id, email: user.email },
      { rememberDevice: rememberDevice !== false }
    );

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
  const { email, password, rememberDevice } = req.body;

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

    const token = generateToken(
      { userId: user.user_id, email: user.email },
      { rememberDevice: rememberDevice !== false }
    );

    // Stamp last_login_at so Echo's morning briefing can summarize "everything
    // since you were last here", bump the total login counter for the beta
    // dashboard, and clear any pending beta inactivity warning (logging in IS
    // the activity the warning asked for). Best-effort — never block a login.
    db.query(
      `UPDATE users
          SET last_login_at = NOW(),
              login_count = login_count + 1,
              beta_warning_sent_at = NULL
        WHERE user_id = $1`,
      [user.user_id]
    ).catch((err) => console.error("last_login_at update failed:", err.message));

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
    // Identity is always the REAL authenticated user (actualUserId); for team
    // members req.user.userId has been remapped to the workspace owner.
    const selfId = req.user.actualUserId || req.user.userId;
    const workspaceId = req.user.userId;

    const result = await db.query(
      `SELECT user_id, email, first_name, preferred_name, phone, subscription_tier, team_size, business_name, industry,
              role, onboarding_completed, onboarding_step, created_at, updated_at
       FROM users
       WHERE user_id = $1`,
      [selfId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // Team members operate inside the owner's workspace: surface the owner's
    // plan/seat/business identity so client-side gating and branding match what
    // the backend actually allows.
    let workspace = user;
    if (req.user.isTeamMember && workspaceId !== selfId) {
      const ws = await db.query(
        `SELECT subscription_tier, team_size, business_name, industry
         FROM users WHERE user_id = $1`,
        [workspaceId]
      );
      if (ws.rows.length > 0) workspace = ws.rows[0];
    }

    return res.json({
      userId: user.user_id,
      email: user.email,
      firstName: user.first_name || null,
      preferredName: user.preferred_name || null,
      phone: user.phone || null,
      subscriptionTier: workspace.subscription_tier,
      teamSize: workspace.team_size,
      businessName: workspace.business_name,
      industry: workspace.industry,
      role: user.role,
      // Team members join an existing workspace — they never run owner onboarding.
      onboardingCompleted: req.user.isTeamMember ? true : user.onboarding_completed,
      onboardingStep: user.onboarding_step,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      // Workspace context for the client.
      workspaceRole: req.user.workspaceRole,
      isTeamMember: Boolean(req.user.isTeamMember),
      isPlatformAdmin: Boolean(req.user.isPlatformAdmin),
      workspaceOwnerId: workspaceId,
      ownerBusinessName: req.user.isTeamMember ? workspace.business_name : null,
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
  const { email, teamSize, businessName, industry, preferredName, phone } = req.body;

  if (
    email === undefined &&
    teamSize === undefined &&
    businessName === undefined &&
    industry === undefined &&
    preferredName === undefined &&
    phone === undefined
  ) {
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
  if (businessName !== undefined) {
    fields.push(`business_name = $${idx++}`);
    values.push(businessName);
  }
  if (industry !== undefined) {
    fields.push(`industry = $${idx++}`);
    values.push(industry);
  }
  if (preferredName !== undefined) {
    // What Echo calls the owner. An empty string clears the preference (Echo
    // falls back to the first name).
    fields.push(`preferred_name = $${idx++}`);
    values.push(
      typeof preferredName === "string" && preferredName.trim()
        ? preferredName.trim().slice(0, 120)
        : null
    );
  }
  if (phone !== undefined) {
    // Mobile number Echo texts for reminder fallbacks and urgent task alerts.
    // Stored normalized (+1XXXXXXXXXX); an empty string clears it.
    if (typeof phone === "string" && phone.trim()) {
      // A bare 10-digit number is a US number typed without the country code —
      // default it to +1 so Twilio can actually deliver the text.
      const digits = phone.replace(/\D/g, "");
      const normalized = normalizeE164(digits.length === 10 ? `1${digits}` : phone);
      if (!normalized) {
        return res
          .status(400)
          .json({ error: "That phone number doesn't look valid — please use a full mobile number." });
      }
      fields.push(`phone = $${idx++}`);
      values.push(normalized);
    } else {
      fields.push(`phone = $${idx++}`);
      values.push(null);
    }
  }

  // Always act on the REAL authenticated user, never the remapped workspace
  // owner — a team member must not be able to edit the owner's account.
  values.push(req.user.actualUserId || req.user.userId);

  try {
    const result = await db.query(
      `UPDATE users
       SET ${fields.join(", ")}
       WHERE user_id = $${idx}
       RETURNING user_id, email, subscription_tier, team_size, business_name, industry, preferred_name, phone, updated_at`,
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
      businessName: user.business_name,
      industry: user.industry,
      preferredName: user.preferred_name || null,
      phone: user.phone || null,
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

/**
 * PUT /profile/onboarding  (protected)
 * Persists onboarding progress so the setup wizard can resume where the user
 * left off. Accepts the current onboarding step and/or a completion flag.
 */
async function updateOnboarding(req, res) {
  const { onboardingStep, onboardingCompleted } = req.body;

  if (onboardingStep === undefined && onboardingCompleted === undefined) {
    return res.status(400).json({ error: "No onboarding fields provided to update" });
  }

  const fields = [];
  const values = [];
  let idx = 1;

  if (onboardingStep !== undefined) {
    const stepNumber = Number(onboardingStep);
    if (!Number.isInteger(stepNumber) || stepNumber < 1) {
      return res.status(400).json({ error: "onboardingStep must be a positive integer" });
    }
    fields.push(`onboarding_step = $${idx++}`);
    values.push(stepNumber);
  }
  if (onboardingCompleted !== undefined) {
    fields.push(`onboarding_completed = $${idx++}`);
    values.push(Boolean(onboardingCompleted));
  }

  // Onboarding progress belongs to the real authenticated user, not the
  // remapped workspace owner.
  const selfId = req.user.actualUserId || req.user.userId;
  values.push(selfId);

  try {
    const result = await db.query(
      `WITH prev AS (
         SELECT user_id, onboarding_completed AS was_completed
         FROM users
         WHERE user_id = $${idx}
       )
       UPDATE users u
       SET ${fields.join(", ")}
       FROM prev
       WHERE u.user_id = prev.user_id
       RETURNING u.user_id, u.onboarding_completed, u.onboarding_step, prev.was_completed`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // Fire the welcome email only on the transition into completion (false -> true),
    // so repeated "completed" updates don't resend it. Best-effort: never block
    // or fail the onboarding response on email delivery.
    if (onboardingCompleted === true && user.onboarding_completed && !user.was_completed) {
      db.query("SELECT email, business_name FROM users WHERE user_id = $1", [selfId])
        .then((r) => {
          const u = r.rows[0];
          if (u) {
            return emailController.sendWelcomeEmail({
              email: u.email,
              business_name: u.business_name,
            });
          }
        })
        .catch((err) => console.error("Welcome email failed:", err.message));
    }

    return res.json({
      userId: user.user_id,
      onboardingCompleted: user.onboarding_completed,
      onboardingStep: user.onboarding_step,
    });
  } catch (err) {
    console.error("Update onboarding error:", err);
    return res.status(500).json({ error: "Failed to update onboarding progress" });
  }
}

/**
 * PUT /profile/password  (protected)
 * Changes the authenticated user's password. Requires the current password to
 * be re-entered (so a stolen/left-open session can't silently take over the
 * account). Always operates on the REAL authenticated user (actualUserId), not
 * the remapped workspace owner — a team member changes their own password.
 */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current password and new password are required" });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters long" });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "New password must be different from the current one" });
  }

  const selfId = req.user.actualUserId || req.user.userId;

  try {
    const result = await db.query(
      "SELECT password_hash FROM users WHERE user_id = $1",
      [selfId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const matches = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!matches) {
      // 400 (not 401): the client's shared request wrapper treats any 401 on
      // an authenticated call as session expiry and force-logs the user out.
      // A mistyped current password is a validation error, not a dead session.
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // Stamp password_changed_at so every previously issued JWT (any other
    // device, or a stolen token) is invalidated by the auth middleware.
    const updated = await db.query(
      `UPDATE users
          SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
        WHERE user_id = $2
        RETURNING email`,
      [newHash, selfId]
    );

    // Issue a fresh token for THIS device so the user who just changed their
    // password stays signed in (their old token is now invalid like all others).
    const token = generateToken({ userId: selfId, email: updated.rows[0].email });

    return res.json({ success: true, message: "Password updated", token });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ error: "Failed to change password" });
  }
}

module.exports = {
  register,
  login,
  signupMode,
  joinWaitlist,
  freeTestModeEnabled,
  getProfile,
  updateProfile,
  updateOnboarding,
  changePassword,
};
