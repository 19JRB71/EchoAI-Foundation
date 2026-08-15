/**
 * Prompt 035 / 035-C1 — H-5 G1 losing-race atomic-rollback regression.
 *
 * G1: if ensureInterviewBrand has already INSERTed the candidate brand and
 * written its stated business_name version inside the transaction, but the
 * session-binding UPDATE then matches ZERO rows (another binding won the
 * race), the ENTIRE transaction must roll back:
 *
 *   - no orphan brand row commits;
 *   - no dangling brand_knowledge_versions row commits;
 *   - the winning session binding is unchanged;
 *   - the call reports failure (null) — the abort is observable.
 *
 * The race is reproduced deterministically, with no production-code change
 * beyond the `_ensureInterviewBrand` test-seam export: the session row in the
 * database is ALREADY bound to the winning brand (the race winner's committed
 * state), while the in-memory session object passed in still shows
 * brand_id = null (the loser's stale view, exactly what the loser holds
 * mid-race). The binding UPDATE's `WHERE brand_id IS NULL` therefore matches
 * zero rows after the insert/stated-version work has run — the precise losing
 * interleaving.
 *
 * Run with:  node --test test/p035.c1.g1RollbackRace.test.js   (from EchoAI/)
 */

require("dotenv").config();
require("../tests/dbGuard");

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const setupAgentController = require("../controllers/setupAgentController");

const createdUserIds = [];

async function createUser() {
  const email = `p035g1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, subscription_tier)
     VALUES ($1, 'not-a-real-hash', 'user'::user_role, 'pro'::subscription_tier)
     RETURNING user_id`,
    [email],
  );
  createdUserIds.push(rows[0].user_id);
  return rows[0].user_id;
}

test.after(async () => {
  if (createdUserIds.length) {
    await db.query(`DELETE FROM brands WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
  }
  await db.pool.end();
});

test("c1.g1LosingRaceRollsBackAtomically — zero-row binding aborts the whole transaction: no orphan brand, no dangling stated version, winner binding untouched", async () => {
  const userId = await createUser();

  // Winner state, already committed: a brand bound to the session.
  const winner = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, 'TEST Race Winner Co') RETURNING brand_id`,
    [userId],
  );
  const winnerBrandId = winner.rows[0].brand_id;
  const sess = await db.query(
    `INSERT INTO setup_sessions (user_id, brand_id, answers)
     VALUES ($1, $2, '{}'::jsonb)
     RETURNING session_id`,
    [userId, winnerBrandId],
  );
  const sessionId = sess.rows[0].session_id;

  const brandsBefore = await db.query(
    `SELECT brand_id FROM brands WHERE user_id = $1 ORDER BY brand_id`,
    [userId],
  );
  const versionsBefore = await db.query(
    `SELECT COUNT(*)::int AS n FROM brand_knowledge_versions v
      JOIN brands b ON b.brand_id = v.brand_id WHERE b.user_id = $1`,
    [userId],
  );

  // The loser's stale in-memory view: session object still shows no brand.
  const staleSession = { session_id: sessionId, brand_id: null };
  const result = await setupAgentController._ensureInterviewBrand(
    userId,
    staleSession,
    "TEST Race Loser Co",
  );

  // 1. The abort is observable: the loser reports failure.
  assert.equal(result, null, "losing race must return null (rolled back)");
  assert.equal(staleSession.brand_id, null, "loser must not adopt a brand id");

  // 2. No orphan brand row committed.
  const brandsAfter = await db.query(
    `SELECT brand_id, brand_name FROM brands WHERE user_id = $1 ORDER BY brand_id`,
    [userId],
  );
  assert.equal(brandsAfter.rows.length, brandsBefore.rows.length, "no new brand row may commit");
  assert.deepEqual(
    brandsAfter.rows.map((r) => r.brand_id),
    brandsBefore.rows.map((r) => r.brand_id),
    "brand set must be unchanged",
  );
  assert.ok(
    !brandsAfter.rows.some((r) => r.brand_name === "TEST Race Loser Co"),
    "the loser's candidate brand must not exist",
  );

  // 3. No dangling stated-version row committed.
  const versionsAfter = await db.query(
    `SELECT COUNT(*)::int AS n FROM brand_knowledge_versions v
      JOIN brands b ON b.brand_id = v.brand_id WHERE b.user_id = $1`,
    [userId],
  );
  assert.equal(
    versionsAfter.rows[0].n,
    versionsBefore.rows[0].n,
    "no stated-version row may survive the rollback",
  );

  // 4. The winning binding is unchanged.
  const bound = await db.query(
    `SELECT brand_id FROM setup_sessions WHERE session_id = $1`,
    [sessionId],
  );
  assert.equal(bound.rows[0].brand_id, winnerBrandId, "winner's session binding must be untouched");
});
