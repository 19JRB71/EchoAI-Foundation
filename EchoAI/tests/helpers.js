// Shared helpers for the AI Setup Agent reliability tests.
//
// Tests run against an isolated test database via the app's own db module, so
// they exercise the exact SQL the controller uses. Each test file creates its
// own throwaway user and cleans it up (ON DELETE CASCADE removes its sessions),
// so tests never touch real accounts.
//
// `./dbGuard` runs first (before `config/db` opens a pool) so the suite prefers
// TEST_DATABASE_URL and hard-fails against anything that looks like production.
require("./dbGuard");

const db = require("../config/db");

async function createTestUser() {
  const email = `setup-agent-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}@example.test`;
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"],
  );
  return rows[0].user_id;
}

async function createSetupSession(userId, overrides = {}) {
  const { rows } = await db.query(
    `INSERT INTO setup_sessions (user_id, status, interview_complete, consent_granted)
     VALUES ($1, $2, TRUE, TRUE)
     RETURNING *`,
    [userId, overrides.status || "in_progress"],
  );
  return rows[0];
}

async function deleteUser(userId) {
  // ON DELETE CASCADE removes the user's setup_sessions rows too.
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

module.exports = { db, createTestUser, createSetupSession, deleteUser };
