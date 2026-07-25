// Proves the test-data safety net (tests/dbGuard.js + tests/resolveTestDb.js)
// cannot be bypassed. The guard's whole job is to (a) hard-fail inside any
// production runtime or against anything that looks like production, and (b)
// redirect an allowed dev run to an isolated test database. If a future refactor
// silently weakens it, these assertions fail before real customer data is ever
// at risk.
//
// Each case runs the guard as a PRELOAD in a fresh child process (exactly how
// `npm test` loads it: `node --require ./tests/dbGuard.js`), with a controlled
// environment. The guard calls process.exit(1) on refusal, so we assert on the
// child's exit code; on success it rewrites process.env.DATABASE_URL, which the
// child prints so we can assert the redirect. No live database is touched — the
// resolver never connects.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const GUARD = path.join(__dirname, "dbGuard.js");

// A benign, non-production dev database URL used as the baseline "allowed" input.
const DEV_URL = "postgres://user:pass@localhost:5432/echoai_dev";

// Run the guard as a preload in a fresh child. `env` is the COMPLETE environment
// (we intentionally do not inherit the parent's env, which already has the
// guard-rewritten DATABASE_URL / marker). On success the child prints the final
// DATABASE_URL the guard settled on.
function runGuard(env) {
  return spawnSync(
    process.execPath,
    ["--require", GUARD, "-e", "process.stdout.write(process.env.DATABASE_URL || '')"],
    {
      cwd: path.join(__dirname, ".."),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      encoding: "utf8",
    },
  );
}

function assertRefused(result, label) {
  assert.notEqual(result.status, 0, `${label}: guard must refuse (non-zero exit)`);
  assert.equal(result.status, 1, `${label}: guard should exit 1`);
  assert.match(
    result.stderr,
    /\[test-db-guard\]/,
    `${label}: refusal should explain itself via the [test-db-guard] message`,
  );
}

test("refuses to run when NODE_ENV=production", () => {
  const result = runGuard({ NODE_ENV: "production", DATABASE_URL: DEV_URL });
  assertRefused(result, "NODE_ENV=production");
});

test("refuses to run when REPLIT_DEPLOYMENT is set (deployed runtime)", () => {
  const result = runGuard({ REPLIT_DEPLOYMENT: "1", DATABASE_URL: DEV_URL });
  assertRefused(result, "REPLIT_DEPLOYMENT set");
});

test("refuses a DATABASE_URL whose HOST looks like production", () => {
  const result = runGuard({
    DATABASE_URL: "postgres://user:pass@db.prod.example.com:5432/echoai",
  });
  assertRefused(result, "prod-looking host");
});

test("refuses a DATABASE_URL whose DB NAME looks like production", () => {
  const result = runGuard({
    DATABASE_URL: "postgres://user:pass@localhost:5432/echoai_production",
  });
  assertRefused(result, "prod-looking db name");
});

test("refuses when DATABASE_URL equals PROD_DATABASE_URL", () => {
  const url = "postgres://user:pass@db.internal:5432/echoai_main";
  const result = runGuard({ DATABASE_URL: url, PROD_DATABASE_URL: url });
  assertRefused(result, "DATABASE_URL == PROD_DATABASE_URL");
});

test("refuses when DATABASE_URL equals PRODUCTION_DATABASE_URL", () => {
  const url = "postgres://user:pass@db.internal:5432/echoai_main";
  const result = runGuard({ DATABASE_URL: url, PRODUCTION_DATABASE_URL: url });
  assertRefused(result, "DATABASE_URL == PRODUCTION_DATABASE_URL");
});

test("TEST_DATABASE_URL overrides DATABASE_URL for the run", () => {
  const testUrl = "postgres://user:pass@localhost:5432/echoai_isolated_test";
  const result = runGuard({ DATABASE_URL: DEV_URL, TEST_DATABASE_URL: testUrl });
  assert.equal(result.status, 0, `guard should allow the run: ${result.stderr}`);
  assert.equal(
    result.stdout,
    testUrl,
    "the run's DATABASE_URL must be redirected to TEST_DATABASE_URL, not the app DB",
  );
});

test("a normal dev DATABASE_URL is allowed and redirected to a derived isolated DB", () => {
  const result = runGuard({ DATABASE_URL: DEV_URL });
  assert.equal(result.status, 0, `guard should allow a dev DB: ${result.stderr}`);
  assert.notEqual(
    result.stdout,
    DEV_URL,
    "the run must NOT use the app's own database directly",
  );
  assert.match(
    result.stdout,
    /echoai_dev_setup_test$/,
    "dev runs are redirected to a derived, isolated *_setup_test database",
  );
});
