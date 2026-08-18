// 026-C3-PM4 (PM4-R1 / PM4-R2 / PM4-R15) — REAL contract binding for the
// authoritative brand readback that AdsDestinationCapture (and other owner
// surfaces) consume:
//
//   GET /api/brands/:brandId → brandController.getBrandProfile
//
// The PM3 live re-proof exposed the second phantom cross-boundary contract in
// the same component: the client mocked api.getBrand → { brand: {...} } with
// facebook_page_id/ad_link_url, but the real endpoint returns a FLAT row that
// (pre-PM4) omitted both Store-3 fields — so a fully successful Save was
// honestly reported as "didn't stick". Standing mock-fidelity rule (PM4 §L):
// this file binds the ACTUAL response shape; the client mocks in
// client/src/onboarding/guided/AdsDestinationCapture.test.jsx derive from it,
// comment-linked.
//
// These tests exercise the REAL controller function with only db.query swapped
// for a row fake (established harness pattern — facebookUnified.test.js,
// facebookAccountsContract.test.js), so the assertions bind the controller's
// genuine serialized contract. Route hardening context (authenticated +
// ownership) is code-enforced: brandRoutes.js applies `router.use(auth,
// lockout)` to every /api/brands route, and the SELECT itself is scoped
// `WHERE brand_id = $1 AND user_id = $2` — the ownership test below binds the
// foreign-owner outcome through that scoping.

const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const brandController = require("../controllers/brandController");

// The exact flat row the post-PM4 SELECT projects (column order mirrors the
// controller; pg returns it as one flat object — no wrapper of any kind).
const FLAT_ROW = {
  brand_id: "d5745758-30a6-462a-baa6-4233216b8f93",
  user_id: "8e55c26c-7ac2-4ea6-9884-1703b0806016",
  brand_name: "South Dixie Storage",
  brand_personality: null,
  voice_description: null,
  visual_style_preferences: null,
  target_audience: null,
  brand_type: "small_business",
  website_url: "https://southdixiestorage.com/",
  facebook_page_url: null,
  instagram_url: null,
  linkedin_url: null,
  youtube_url: null,
  tiktok_url: null,
  google_business_url: null,
  facebook_page_id: "140006069194366",
  ad_link_url: "https://southdixiestorage.com/",
  created_at: "2026-08-15T00:00:00.000Z",
  updated_at: "2026-08-18T13:48:28.000Z",
};

// Secret/token-class fields that must NEVER enter this owner-facing
// projection (PM4-R15). Names follow the real codebase: api_integrations
// carries api_token_encrypted / facebook_page_tokens; other provider
// credential columns follow the *_token / *_secret / *_key / *_credential
// naming families. Guarded by CLASS (pattern), not by a brittle whole-shape
// snapshot, so harmless owner-visible fields can be added later without
// breaking this test.
const SECRET_FIELD_PATTERNS = [
  /token/i, // access tokens, refresh tokens, page tokens, encrypted token blobs
  /secret/i, // provider secrets
  /credential/i,
  /password/i,
  /api_key/i,
  /private_key/i,
  /oauth/i, // OAuth authorization material
  /encrypted/i, // encrypted credential blobs
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

test("PM4-R1: GET /api/brands/:brandId (real controller) returns the FLAT row — no { brand } wrapper — including facebook_page_id and ad_link_url", async () => {
  const orig = db.query;
  let boundParams = null;
  db.query = async (sql, params) => {
    if (sql.includes("FROM brands") && sql.includes("WHERE brand_id = $1 AND user_id = $2")) {
      assert.ok(
        sql.includes("facebook_page_id") && sql.includes("ad_link_url"),
        "PM4 SELECT must project both Store-3 fields",
      );
      boundParams = params;
      return { rows: [FLAT_ROW] };
    }
    throw new Error("unexpected query: " + sql);
  };
  try {
    const res = makeRes();
    await brandController.getBrandProfile(
      { user: { userId: FLAT_ROW.user_id }, params: { brandId: FLAT_ROW.brand_id } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);

    // FLAT contract: the row itself is the response. No wrapper key.
    assert.strictEqual(res.body.brand, undefined, "no { brand } wrapper — flat row is canonical");
    assert.strictEqual(res.body, FLAT_ROW);

    // The two Store-3 fields the authoritative reread depends on (PM4-R4).
    assert.strictEqual(res.body.facebook_page_id, "140006069194366");
    assert.strictEqual(res.body.ad_link_url, "https://southdixiestorage.com/");

    // Ownership scoping is bound into the query itself.
    assert.deepStrictEqual(boundParams, [FLAT_ROW.brand_id, FLAT_ROW.user_id]);
  } finally {
    db.query = orig;
  }
});

test("PM4-R2: a foreign user cannot read another owner's brand — ownership-scoped SELECT yields 404, no data leaks", async () => {
  const orig = db.query;
  db.query = async (sql, params) => {
    // Real behavior: the WHERE brand_id AND user_id scoping returns zero rows
    // for a non-owner; the controller answers 404 with no brand fields.
    assert.strictEqual(params[1], "intruder-user");
    return { rows: [] };
  };
  try {
    const res = makeRes();
    await brandController.getBrandProfile(
      { user: { userId: "intruder-user" }, params: { brandId: FLAT_ROW.brand_id } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.body, { error: "Brand not found" });
  } finally {
    db.query = orig;
  }
});

test("PM4-R15: no secret/token-class field enters the brand-profile projection (controller SELECT and serialized response)", async () => {
  // Guard 1 — the projection source: read the controller's own SELECT text and
  // assert no secret-class column is projected.
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../controllers/brandController.js"), "utf8");
  const fnSrc = src.slice(src.indexOf("async function getBrandProfile"), src.indexOf("async function getBrandProfile") + 1500);
  const selectText = fnSrc.slice(fnSrc.indexOf("SELECT"), fnSrc.indexOf("FROM brands"));
  for (const pat of SECRET_FIELD_PATTERNS) {
    assert.ok(!pat.test(selectText), `secret-class pattern ${pat} must not appear in the getBrandProfile SELECT`);
  }

  // Guard 2 — the serialized response: every key of the returned flat row is
  // checked against the secret-class patterns.
  const orig = db.query;
  db.query = async () => ({ rows: [FLAT_ROW] });
  try {
    const res = makeRes();
    await brandController.getBrandProfile(
      { user: { userId: FLAT_ROW.user_id }, params: { brandId: FLAT_ROW.brand_id } },
      res,
    );
    for (const key of Object.keys(res.body)) {
      for (const pat of SECRET_FIELD_PATTERNS) {
        assert.ok(!pat.test(key), `response field "${key}" matches secret-class pattern ${pat}`);
      }
    }
    // facebook_page_id and ad_link_url are owner-visible business
    // configuration (a public Page's id and the owner's own landing URL) —
    // not tokens, credentials, or authentication artifacts.
    assert.ok("facebook_page_id" in res.body);
    assert.ok("ad_link_url" in res.body);
  } finally {
    db.query = orig;
  }
});
