// pretest hook (npm runs it automatically before `npm test`).
//
// Ensures the isolated test database chosen by resolveTestDb.js exists and has
// the full schema applied, WITHOUT ever mutating the app's real database:
//   1. Decide the isolated test DB (fail fast on any production runtime).
//   2. If it was auto-derived, CREATE it if missing (connecting to the original
//      database purely as a maintenance connection — CREATE DATABASE only).
//   3. Run the app's own idempotent migrations against the test DB (in a child
//      process so config/db.js binds to the test URL cleanly).

require("dotenv").config();

const fs = require("node:fs");
const { Client } = require("pg");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { planTestDatabase, dbNameOf, fail } = require("./resolveTestDb");

async function ensureDerivedDatabaseExists(plan) {
  // Only auto-create databases we derived ourselves. An operator-supplied
  // TEST_DATABASE_URL is assumed to already exist (it may live on another server
  // we have no rights to create on).
  if (!plan.derived) return;

  const testName = plan.testName;
  // Connect to the ORIGINAL database only as a maintenance connection so we can
  // issue CREATE DATABASE for the separate test database. We never write app data
  // here — the only statement is the CREATE.
  const admin = new Client({ connectionString: plan.originalUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [testName],
    );
    if (rows.length === 0) {
      // CREATE DATABASE cannot be parameterized; testName is derived from our own
      // DATABASE_URL (not user input) and quoted defensively.
      await admin.query(`CREATE DATABASE "${testName.replace(/"/g, '""')}"`);
      console.log(`[test-db-setup] created isolated test database "${testName}"`);
    } else {
      console.log(`[test-db-setup] isolated test database "${testName}" already exists`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  const plan = planTestDatabase();
  const test = new URL(plan.testUrl);
  console.log(
    `[test-db-setup] using isolated test database host="${test.hostname}" ` +
      `db="${dbNameOf(test)}" (${plan.derived ? "auto-derived" : "TEST_DATABASE_URL"})`,
  );

  await ensureDerivedDatabaseExists(plan);

  // The base tables live in models/schema.sql. The migration runner now applies
  // it first automatically, but we also apply it explicitly here as a
  // belt-and-suspenders bootstrap for a fresh test DB before the numbered
  // migrations, which build on top. It is idempotent (CREATE ... IF NOT EXISTS +
  // DO-block enum guards), so re-running it (here and in the runner) is safe.
  const schemaPath = path.join(__dirname, "..", "models", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const client = new Client({ connectionString: plan.testUrl });
  await client.connect();
  try {
    await client.query(schemaSql);
    console.log("[test-db-setup] applied base schema.sql");
  } finally {
    await client.end();
  }

  // Apply the incremental migrations to the test DB via the app's own migration
  // runner, in a child process whose DATABASE_URL is the test URL.
  const runner = path.join(__dirname, "..", "utils", "runMigrations.js");
  execFileSync("node", [runner], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: plan.testUrl },
  });
}

main().catch((err) => {
  fail(`Failed to prepare the isolated test database: ${err.message}`);
});
