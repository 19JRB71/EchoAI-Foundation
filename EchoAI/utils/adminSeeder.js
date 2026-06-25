const bcrypt = require("bcrypt");
const db = require("../config/db");

const SALT_ROUNDS = 10;

/**
 * Creates the platform admin account on first startup if it does not already
 * exist, using credentials from the ADMIN_EMAIL and ADMIN_PASSWORD environment
 * variables. If a user with that email already exists but isn't an admin, it is
 * promoted. The seeder is a no-op when the credentials aren't configured.
 */
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn(
      "Admin seeder skipped: ADMIN_EMAIL and ADMIN_PASSWORD are not set."
    );
    return;
  }

  const client = await db.getClient();
  try {
    const existing = await client.query(
      "SELECT user_id, role FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].role !== "admin") {
        await client.query("UPDATE users SET role = 'admin' WHERE user_id = $1", [
          existing.rows[0].user_id,
        ]);
        console.log(`Existing user promoted to admin: ${email}`);
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO users (email, password_hash, role, subscription_tier, onboarding_completed)
       VALUES ($1, $2, 'admin', 'enterprise', TRUE)
       RETURNING user_id`,
      [email, passwordHash]
    );
    await client.query(
      `INSERT INTO subscriptions (user_id, subscription_tier, billing_cycle, payment_status)
       VALUES ($1, 'enterprise', 'monthly', 'active')`,
      [inserted.rows[0].user_id]
    );
    await client.query("COMMIT");

    console.log(`Admin account created: ${email}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Admin seeder error:", err.message);
  } finally {
    client.release();
  }
}

module.exports = { seedAdmin };
