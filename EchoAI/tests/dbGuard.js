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

// TEST-ONLY env defaults (REPLIT_PROMPT_013): a clean checkout has none of the
// provider keys, and the suite silently depended on them — module-level client
// constructors log "disabled" warnings and any code path that touches
// utils/encryption.js (e.g. tests that seed encrypted fixtures with encrypt())
// throws without ENCRYPTION_KEY. Every provider SDK is stubbed in tests, so
// obviously-fake dummies suffice. This block is unreachable outside test runs:
// this file is only loaded via the `npm test` preload / tests/helpers.js, and
// planTestDatabase() above has already hard-failed if this is a production
// runtime (NODE_ENV=production or REPLIT_DEPLOYMENT). Real values, when
// present, are always respected — we only fill gaps.
if (!process.env.ENCRYPTION_KEY) {
  // Must be exactly 32 bytes (utils/encryption.js requirement).
  process.env.ENCRYPTION_KEY = "echoai-test-only-encryption-32b!";
}
if (!process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = "test-only-fake-anthropic-key";
}
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "test-only-fake-openai-key";
}
if (!process.env.ELEVENLABS_API_KEY) {
  process.env.ELEVENLABS_API_KEY = "test-only-fake-elevenlabs-key";
}
// The other boot-critical secrets (config/env.js CRITICAL list) that tests
// exercise directly: setup-agent/e2e tests sign real JWTs with JWT_SECRET, and
// OAuth CSRF session code reads SESSION_SECRET. Same rules: test-only,
// obviously fake, real values always win.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-only-fake-jwt-secret";
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-only-fake-session-secret";
}

module.exports = { testUrl };
