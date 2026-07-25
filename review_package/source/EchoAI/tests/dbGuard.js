// Test-database safety guard (side-effecting).
//
// Preloaded via `node --require ./tests/dbGuard.js` (see the `test` npm script) so
// it runs BEFORE any test file — and therefore before `config/db.js` reads
// `DATABASE_URL`. It is also required by `tests/helpers.js` and the e2e test as
// defense-in-depth for direct single-file runs.
//
// The onboarding suite creates and DELETEs real users/brands/subscriptions rows.
// This guard makes it impossible for those writes to land on real customer data:
// it redirects the whole run to a dedicated, physically-isolated test database
// (see resolveTestDb.js) and hard-fails inside any production runtime. There is
// no fallback that runs against the app's real database.

require("dotenv").config();

const { planTestDatabase } = require("./resolveTestDb");

// `node --test` runs each test file in a child process that inherits this
// process's env — including the DATABASE_URL we rewrite below. Without a marker,
// the child would re-derive a test DB from the already-derived URL (a double
// "_setup_test_setup_test" suffix). The marker makes redirection idempotent
// across the parent preload and every child.
const MARKER = "__ECHOAI_TEST_DB_URL";

let testUrl;
if (process.env[MARKER]) {
  testUrl = process.env[MARKER];
} else {
  ({ testUrl } = planTestDatabase());
  process.env[MARKER] = testUrl;
}

// From here on, everything that reads process.env.DATABASE_URL (config/db.js, the
// migration runner, etc.) sees the isolated test database — never the real one.
process.env.DATABASE_URL = testUrl;

// AI cost controls in tests: every AI-wrapper suite stubs the provider SDK, so
// no real credits can be spent — but the admission gate (utils/aiGate.js) would
// otherwise 503 every stubbed call (this is a development environment) and the
// per-minute rate limit would throttle fast stub loops. Lift both HERE, for the
// test run only. Tests that verify the dev-block/rate-limit behavior override
// these process-locally. Respect explicit values so a suite can be launched
// with different policy on purpose.
if (process.env.DEVELOPMENT_AI_ENABLED === undefined) {
  process.env.DEVELOPMENT_AI_ENABLED = "true";
}
if (process.env.AI_MAX_CALLS_PER_MINUTE === undefined) {
  process.env.AI_MAX_CALLS_PER_MINUTE = "0"; // 0 = unlimited
}

module.exports = { testUrl };
