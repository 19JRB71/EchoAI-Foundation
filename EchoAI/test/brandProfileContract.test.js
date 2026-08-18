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

    // PM4b(ii) — EXACT-KEY ALLOWLIST: the serialized brand-profile response is
    // bound to this exact key set. Any field added to (or dropped from) the
    // projection must consciously update this list. Together with the
    // secret-class name scan below (PM4-R15) this forms the accepted safety
    // guard.
    const EXPECTED_PROFILE_KEYS = [
      "brand_id", "user_id", "brand_name", "brand_personality",
      "voice_description", "visual_style_preferences", "target_audience",
      "brand_type", "website_url", "facebook_page_url", "instagram_url",
      "linkedin_url", "youtube_url", "tiktok_url", "google_business_url",
      "facebook_page_id", "ad_link_url", "created_at", "updated_at",
    ];
    assert.deepStrictEqual(
      Object.keys(res.body).sort(),
      EXPECTED_PROFILE_KEYS.slice().sort(),
      "brand-profile response must carry EXACTLY the allowlisted keys",
    );

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

// ---------------------------------------------------------------------------
// 026-C3-PM4b(i) — sweep completion: the two remaining inspection-only reads
// used by AdsDestinationCapture's brand-resolution fallback are bound to their
// REAL serialized contracts (code inspection alone ruled insufficient after
// two phantom contracts were found in this component's history).
// ---------------------------------------------------------------------------

test("PM4b: GET /api/brands/active/selection (real controller) serializes exactly { brandId } from the owned-brand-joined lookup", async () => {
  const orig = db.query;
  let boundParams = null;
  db.query = async (sql, params) => {
    // Real query: users.last_active_brand_id JOINed against brands ON
    // brand_id AND user_id — a brand the user no longer owns can never be
    // returned as active. Bind that scoping.
    assert.ok(
      sql.includes("last_active_brand_id") &&
        sql.includes("JOIN brands b ON b.brand_id = u.last_active_brand_id AND b.user_id = u.user_id"),
      "active-brand lookup must be owned-brand-joined",
    );
    boundParams = params;
    return { rows: [{ brand_id: FLAT_ROW.brand_id }] };
  };
  try {
    const res = makeRes();
    await brandController.getActiveBrand({ user: { userId: FLAT_ROW.user_id } }, res);
    assert.strictEqual(res.statusCode, 200);
    // EXACT shape: one key, no wrapper, no extra/secret fields.
    assert.deepStrictEqual(Object.keys(res.body), ["brandId"]);
    assert.strictEqual(res.body.brandId, FLAT_ROW.brand_id);
    assert.deepStrictEqual(boundParams, [FLAT_ROW.user_id]);
  } finally {
    db.query = orig;
  }
});

test("PM4b: GET /api/brands/active/selection with no owned active brand serializes { brandId: null } — same single-key shape", async () => {
  const orig = db.query;
  db.query = async () => ({ rows: [] });
  try {
    const res = makeRes();
    await brandController.getActiveBrand({ user: { userId: "user-without-active" } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(Object.keys(res.body), ["brandId"]);
    assert.strictEqual(res.body.brandId, null);
  } finally {
    db.query = orig;
  }
});

test("PM4b: GET /api/brands (real controller) serializes exactly { count, brands: [flat rows] } — ownership-scoped, flat, no secret-class fields", async () => {
  const LIST_ROW = {
    brand_id: FLAT_ROW.brand_id,
    brand_name: "South Dixie Storage",
    brand_personality: null,
    voice_description: null,
    visual_style_preferences: null,
    target_audience: null,
    brand_type: "small_business",
    is_demo: false,
    demo_tier: null,
    website_url: "https://southdixiestorage.com/",
    facebook_page_url: null,
    instagram_url: null,
    linkedin_url: null,
    youtube_url: null,
    tiktok_url: null,
    google_business_url: null,
    created_at: "2026-08-15T00:00:00.000Z",
    updated_at: "2026-08-18T13:48:28.000Z",
  };
  const orig = db.query;
  let boundParams = null;
  db.query = async (sql, params) => {
    assert.ok(sql.includes("FROM brands") && sql.includes("WHERE user_id = $1"), "list must be ownership-scoped");
    for (const pat of SECRET_FIELD_PATTERNS) {
      const selectText = sql.slice(sql.indexOf("SELECT"), sql.indexOf("FROM brands"));
      assert.ok(!pat.test(selectText), `secret-class pattern ${pat} must not appear in the getBrands SELECT`);
    }
    boundParams = params;
    return { rows: [LIST_ROW] };
  };
  try {
    const res = makeRes();
    await brandController.getBrands({ user: { userId: FLAT_ROW.user_id } }, res);
    assert.strictEqual(res.statusCode, 200);
    // EXACT top-level shape.
    assert.deepStrictEqual(Object.keys(res.body).sort(), ["brands", "count"]);
    // count semantics = number of returned rows.
    assert.strictEqual(res.body.count, 1);
    assert.ok(Array.isArray(res.body.brands));
    // Each element is the FLAT row itself — no per-item wrapper.
    assert.strictEqual(res.body.brands[0], LIST_ROW);
    assert.strictEqual(res.body.brands[0].brand, undefined);
    // No secret-class field on the serialized rows.
    for (const key of Object.keys(res.body.brands[0])) {
      for (const pat of SECRET_FIELD_PATTERNS) {
        assert.ok(!pat.test(key), `brands[] field "${key}" matches secret-class pattern ${pat}`);
      }
    }
    // AdsDestinationCapture's fallback consumes list.brands[0].brand_id — bind it.
    assert.strictEqual(res.body.brands[0].brand_id, FLAT_ROW.brand_id);
    assert.deepStrictEqual(boundParams, [FLAT_ROW.user_id]);
  } finally {
    db.query = orig;
  }
});

