const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Unified Facebook connection: one OAuth login serves both Atlas (ads) and Nova
// (organic Page posting). These tests cover the posting-side wiring that the
// merge introduces:
//   - resolveFacebookPageToken: a brand's Page token is resolved LIVE from the
//     owning user's api_integrations (single source of truth), keyed by pageId
//   - loadConnectedAccount(facebook): a pageId-only social_accounts row gets its
//     Page token injected from api_integrations; a legacy row that already
//     carries its own accessToken is used unchanged (back-compat)
//   - setFacebookBrandPage: happy path stores ONLY the pageId (never the token);
//     a Page with no captured publish token is rejected with needsReconnect
// Tests never touch a real database or the network: db.query is swapped for a
// fake keyed on SQL substrings (same approach as socialReverify.test.js).
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const { encrypt, decrypt } = require("../utils/encryption");
const socialController = require("../controllers/socialController");
const { resolveFacebookPageToken, setFacebookBrandPage } = socialController;

const PAGE_TOKENS = encrypt(JSON.stringify({ p1: "PAGE_TOKEN_1", p2: "PAGE_TOKEN_2" }));
const PAGES = [
  { id: "p1", name: "Acme Page", category: "Business" },
  { id: "p2", name: "Acme Blog", category: "Blog" },
];

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("resolveFacebookPageToken returns the live Page token for the given pageId", async () => {
  const orig = db.query;
  db.query = async (sql) => {
    if (sql.includes("FROM api_integrations ai") && sql.includes("JOIN brands b")) {
      return { rows: [{ facebook_page_tokens: PAGE_TOKENS }] };
    }
    throw new Error("unexpected query: " + sql);
  };
  try {
    const token = await resolveFacebookPageToken("brand-1", "p2");
    assert.strictEqual(token, "PAGE_TOKEN_2");
    const missing = await resolveFacebookPageToken("brand-1", "nope");
    assert.strictEqual(missing, null);
  } finally {
    db.query = orig;
  }
});

test("resolveFacebookPageToken returns null when the user has no FB connection", async () => {
  const orig = db.query;
  db.query = async () => ({ rows: [] });
  try {
    const token = await resolveFacebookPageToken("brand-1", "p1");
    assert.strictEqual(token, null);
  } finally {
    db.query = orig;
  }
});

test("setFacebookBrandPage stores ONLY the pageId (never the token) and returns the account", async () => {
  const orig = db.query;
  let storedCredentials = null;
  db.query = async (sql, params) => {
    if (sql.includes("FROM brands") && sql.includes("WHERE brand_id = $1 AND user_id = $2")) {
      return { rows: [{ brand_id: "brand-1", brand_name: "Acme" }] };
    }
    if (sql.includes("SELECT facebook_pages, facebook_page_tokens")) {
      return { rows: [{ facebook_pages: PAGES, facebook_page_tokens: PAGE_TOKENS }] };
    }
    if (sql.includes("FROM\n") || sql.includes("users u") || sql.includes("subscription_tier")) {
      return { rows: [{ role: "admin", tier: "enterprise" }] };
    }
    if (sql.includes("INSERT INTO social_accounts")) {
      storedCredentials = params[2]; // credentials_encrypted
      return {
        rows: [
          {
            account_id: "acc-1",
            platform: "facebook",
            platform_username: params[1],
            connection_status: "connected",
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
      };
    }
    throw new Error("unexpected query: " + sql);
  };
  try {
    const req = { user: { userId: "u1" }, body: { brandId: "brand-1", pageId: "p1" } };
    const res = makeRes();
    await setFacebookBrandPage(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.pageId, "p1");
    assert.strictEqual(res.body.account.username, "Acme Page");
    // The stored credential blob must contain the pageId and NOT the token.
    const creds = JSON.parse(decrypt(storedCredentials));
    assert.deepStrictEqual(creds, { pageId: "p1" });
    assert.ok(!("accessToken" in creds), "token must never be copied into social_accounts");
  } finally {
    db.query = orig;
  }
});

test("setFacebookBrandPage rejects a Page with no captured publish token (needsReconnect)", async () => {
  const orig = db.query;
  const noTokens = encrypt(JSON.stringify({})); // connected but no page tokens captured
  db.query = async (sql) => {
    if (sql.includes("FROM brands") && sql.includes("WHERE brand_id = $1 AND user_id = $2")) {
      return { rows: [{ brand_id: "brand-1", brand_name: "Acme" }] };
    }
    if (sql.includes("SELECT facebook_pages, facebook_page_tokens")) {
      return { rows: [{ facebook_pages: PAGES, facebook_page_tokens: noTokens }] };
    }
    throw new Error("unexpected query: " + sql);
  };
  try {
    const req = { user: { userId: "u1" }, body: { brandId: "brand-1", pageId: "p1" } };
    const res = makeRes();
    await setFacebookBrandPage(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.needsReconnect, true);
  } finally {
    db.query = orig;
  }
});

test("setFacebookBrandPage 400s when brandId or pageId is missing", async () => {
  const req = { user: { userId: "u1" }, body: { brandId: "brand-1" } };
  const res = makeRes();
  await setFacebookBrandPage(req, res);
  assert.strictEqual(res.statusCode, 400);
});
