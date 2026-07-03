// Pure resolver for the onboarding test database — NO side effects on import.
//
// The onboarding suite creates and DELETEs real users/brands/subscriptions rows.
// To guarantee it can never touch real customer data, tests must run against a
// database that is *physically separate* from the app's real database (a distinct
// Postgres database namespace shares no tables), and must refuse outright inside
// any production runtime.
//
// This module decides which database the suite is allowed to use. It never
// connects; `dbGuard.js` applies the decision and `setupTestDb.js` provisions it.

function fail(message) {
  console.error(
    `\n[test-db-guard] Refusing to run the onboarding test suite.\n` +
      `[test-db-guard] ${message}\n` +
      `[test-db-guard] These tests create and DELETE real rows, so they only run\n` +
      `[test-db-guard] against a dedicated, isolated test database — never the app's\n` +
      `[test-db-guard] real database. Set TEST_DATABASE_URL to an isolated test DB,\n` +
      `[test-db-guard] or run from a non-production environment so one can be derived.\n`,
  );
  process.exit(1);
}

function parseOrFail(url, label) {
  try {
    return new URL(url);
  } catch {
    return fail(`${label} is not a valid Postgres connection URL.`);
  }
}

function dbNameOf(u) {
  return decodeURIComponent(u.pathname || "").replace(/^\//, "");
}

function looksLikeProduction(u) {
  const host = (u.hostname || "").toLowerCase();
  const db = dbNameOf(u).toLowerCase();
  return host.includes("prod") || db.includes("prod");
}

// Same physical database? (host + port + database name)
function sameDatabase(a, b) {
  const portA = a.port || "5432";
  const portB = b.port || "5432";
  return (
    a.hostname === b.hostname &&
    portA === portB &&
    dbNameOf(a) === dbNameOf(b)
  );
}

function assertNotKnownProdUrl(rawUrl, label) {
  for (const key of ["PROD_DATABASE_URL", "PRODUCTION_DATABASE_URL"]) {
    if (process.env[key] && process.env[key] === rawUrl) {
      fail(`${label} is identical to ${key} (the production database).`);
    }
  }
}

/**
 * Decide the test database to use. Returns:
 *   { testUrl, originalUrl, derived }
 * `derived` is true when the URL was auto-derived (a new, isolated database on
 * the same server that setupTestDb.js must create); false when the operator
 * supplied TEST_DATABASE_URL (assumed to already exist).
 *
 * Exits the process with a clear message when it cannot guarantee isolation.
 */
function planTestDatabase() {
  // Never run destructive tests inside a production runtime.
  if (process.env.NODE_ENV === "production") {
    fail("NODE_ENV=production — this is a production runtime.");
  }
  if (process.env.REPLIT_DEPLOYMENT) {
    fail("REPLIT_DEPLOYMENT is set — this is a deployed (production) environment.");
  }

  const originalRaw = process.env.DATABASE_URL;

  // 1. Explicit, operator-provided isolated test database wins.
  if (process.env.TEST_DATABASE_URL) {
    const rawTest = process.env.TEST_DATABASE_URL;
    const test = parseOrFail(rawTest, "TEST_DATABASE_URL");
    assertNotKnownProdUrl(rawTest, "TEST_DATABASE_URL");
    if (looksLikeProduction(test)) {
      fail(
        `TEST_DATABASE_URL looks like production (host="${test.hostname}", ` +
          `db="${dbNameOf(test)}").`,
      );
    }
    if (originalRaw) {
      const original = parseOrFail(originalRaw, "DATABASE_URL");
      if (sameDatabase(original, test)) {
        fail(
          "TEST_DATABASE_URL points at the SAME database as DATABASE_URL — it must " +
            "be a separate, disposable database.",
        );
      }
    }
    return { testUrl: rawTest, originalUrl: originalRaw || null, derived: false };
  }

  // 2. Otherwise derive an isolated test database on the same server.
  if (!originalRaw) {
    fail("No database is configured (set TEST_DATABASE_URL or DATABASE_URL).");
  }
  const original = parseOrFail(originalRaw, "DATABASE_URL");
  assertNotKnownProdUrl(originalRaw, "DATABASE_URL");
  if (looksLikeProduction(original)) {
    fail(
      `DATABASE_URL looks like production (host="${original.hostname}", ` +
        `db="${dbNameOf(original)}"); refusing to derive a test database there.`,
    );
  }
  const baseName = dbNameOf(original);
  if (!baseName) {
    fail("DATABASE_URL has no database name to derive an isolated test database from.");
  }
  const testName = `${baseName}_setup_test`;
  const derivedUrl = new URL(originalRaw);
  derivedUrl.pathname = `/${encodeURIComponent(testName)}`;
  return { testUrl: derivedUrl.toString(), originalUrl: originalRaw, derived: true, testName };
}

module.exports = {
  planTestDatabase,
  fail,
  parseOrFail,
  dbNameOf,
  sameDatabase,
  looksLikeProduction,
};
