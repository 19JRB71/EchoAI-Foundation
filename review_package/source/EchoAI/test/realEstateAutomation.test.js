const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Real-estate automation regressions:
//  1. Sweep guards — one brand's (or one listing's) hard failure must never
//     stop the rest of the sweep (mirrors recurringSweeps.test.js).
//  2. Atomic claim + release-on-AI-fail — the listing-promotion marker is
//     claimed atomically (rowCount branch) and released when the AI call
//     fails, so a later tick retries and concurrent ticks can't double-draft.
//  3. postTextFrom — the AI variation object becomes honest, ready-to-post
//     text (postText + hashtags), never "[object Object]".
// ---------------------------------------------------------------------------

const automation = require("../utils/realEstateAutomation");

test("postTextFrom joins postText and hashtags, tolerates strings", () => {
  assert.strictEqual(
    automation.postTextFrom({ postText: "Open house!", hashtags: ["#home", "#tulsa"] }),
    "Open house!\n\n#home #tulsa"
  );
  assert.strictEqual(automation.postTextFrom("plain text"), "plain text");
  assert.strictEqual(automation.postTextFrom({ postText: "no tags" }), "no tags");
});

test("CONTENT_TOPICS rotation covers 3 distinct slots in a day", () => {
  const dayIndex = 12345;
  const topics = [0, 1, 2].map(
    (slot) => automation.CONTENT_TOPICS[(dayIndex * 3 + slot) % automation.CONTENT_TOPICS.length]
  );
  assert.strictEqual(new Set(topics).size, 3);
});

function fakeBrand(id) {
  return { brand_id: id, brand_name: `Brand ${id}`, user_id: `u-${id}`, brand_type: "real_estate" };
}

test("listing promotion sweep: one listing's failure doesn't stop the rest", async (t) => {
  const state = { promoted: [], released: [] };
  const origQuery = db.query;
  const origPromote = automation.promoteListing;

  db.query = async (sql, params = []) => {
    if (/FROM brands/i.test(sql)) {
      return { rows: [fakeBrand("b1"), fakeBrand("b2")] };
    }
    if (/FROM property_listings/i.test(sql) && /ad_promoted_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      return {
        rows: [{ listing_id: `L-${params[0]}`, address: `1 Main St ${params[0]}`, brand_id: params[0] }],
      };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  automation.promoteListing = async (listing) => {
    if (listing.brand_id === "b1") throw new Error("boom for b1");
    state.promoted.push(listing.listing_id);
    return true;
  };
  t.after(() => {
    db.query = origQuery;
    automation.promoteListing = origPromote;
  });

  const drafted = await automation.runListingPromotionSweep();
  assert.strictEqual(drafted, 1);
  assert.deepStrictEqual(state.promoted, ["L-b2"]);
});

test("promoteListing: atomic claim skips already-claimed rows and releases on AI failure", async (t) => {
  const state = { markerNulled: 0, inserts: 0 };
  const origQuery = db.query;
  db.query = async (sql, params = []) => {
    if (/UPDATE property_listings SET ad_promoted_at = NOW\(\)/i.test(sql)) {
      // First listing is already claimed by another tick; second claims fine.
      return params[0] === "L-claimed" ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{}] };
    }
    if (/SET ad_promoted_at = NULL/i.test(sql)) {
      state.markerNulled += 1;
      return { rowCount: 1, rows: [] };
    }
    if (/INSERT INTO ad_creatives/i.test(sql)) {
      state.inserts += 1;
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  t.after(() => {
    db.query = origQuery;
  });

  const brand = fakeBrand("b1");

  // Already claimed → returns false, no AI, no insert.
  const skipped = await automation.promoteListing(
    { listing_id: "L-claimed", address: "2 Oak Ave" },
    brand
  );
  assert.strictEqual(skipped, false);
  assert.strictEqual(state.inserts, 0);

  // Claims, then the AI call fails (no ANTHROPIC key needed — the controller
  // throws before persisting) → the marker must be released for a later retry.
  await assert.rejects(
    automation.promoteListing({ listing_id: "L-new", address: "3 Elm St", price: 100 }, brand)
  );
  assert.strictEqual(state.markerNulled, 1);
  assert.strictEqual(state.inserts, 0);
});

test("RE content run: manual posts never suppress it; slot-key dedup + ON CONFLICT stop double-scheduling", async (t) => {
  const origQuery = db.query;
  const state = { inserts: [], insertedKeys: new Set() };

  db.query = async (sql, params = []) => {
    if (/FROM brands/i.test(sql)) return { rows: [fakeBrand("b1")] };
    if (/FROM social_accounts/i.test(sql)) {
      return { rows: [{ platform: "facebook" }] };
    }
    // Slot-key dedup read: only rows with OUR source key count — a manual
    // post (source NULL) must never match this query shape.
    if (/FROM social_posts/i.test(sql) && /source = \$2/i.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO social_posts/i.test(sql)) {
      assert.match(sql, /ON CONFLICT \(brand_id, platform, source\)/i);
      const key = `${params[0]}|${params[1]}|${params[3]}`;
      if (state.insertedKeys.has(key)) return { rowCount: 0, rows: [] }; // conflict
      state.insertedKeys.add(key);
      state.inserts.push(params[3]);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  // Stub the AI so no key is needed.
  const socialPrompt = require("../prompts/socialContentPrompt");
  const origGen = socialPrompt.generateSocialPosts;
  socialPrompt.generateSocialPosts = async () => [{ postText: "RE tip", hashtags: ["#home"] }];
  t.after(() => {
    db.query = origQuery;
    socialPrompt.generateSocialPosts = origGen;
  });

  // Fresh module instance so the stubbed generateSocialPosts is picked up.
  delete require.cache[require.resolve("../utils/realEstateAutomation")];
  const auto = require("../utils/realEstateAutomation");

  const first = await auto.runRealEstateContentRun(1);
  assert.strictEqual(first, 1);
  assert.match(state.inserts[0], /^re_auto:\d{4}-\d{2}-\d{2}:1$/);

  // Same slot again (overlapping tick): the unique key conflicts → 0 scheduled.
  const second = await auto.runRealEstateContentRun(1);
  assert.strictEqual(second, 0);
});

test("claimSellerLeadSlot: two racing claims yield exactly one creative (advisory lock)", async () => {
  // Real DB — mirrors the setup-lease race tests. Needs a real user + brand.
  const { rows: userRows } = await db.query(
    `INSERT INTO users (email, password_hash)
     VALUES ('re-claim-test-${Date.now()}@test.local', 'x')
     RETURNING user_id`
  );
  const userId = userRows[0].user_id;
  const { rows: brandRows } = await db.query(
    `INSERT INTO brands (user_id, brand_name, brand_type)
     VALUES ($1, 'RE Claim Brand', 'real_estate') RETURNING brand_id`,
    [userId]
  );
  const brandId = brandRows[0].brand_id;
  try {
    const results = await Promise.all([
      automation.claimSellerLeadSlot(brandId),
      automation.claimSellerLeadSlot(brandId),
      automation.claimSellerLeadSlot(brandId),
    ]);
    const winners = results.filter(Boolean);
    assert.strictEqual(winners.length, 1, `expected exactly 1 winner, got ${winners.length}`);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ad_creatives
        WHERE brand_id = $1 AND creative_concept->>'autoSource' = 'seller_lead'`,
      [brandId]
    );
    assert.strictEqual(rows[0].n, 1);
  } finally {
    await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
  }
});

test("open house sweep: per-brand guard contains a broken brand", async (t) => {
  const origQuery = db.query;
  const origPromote = automation.promoteOpenHouse;
  const state = { promoted: [] };

  db.query = async (sql, params = []) => {
    if (/FROM brands/i.test(sql)) return { rows: [fakeBrand("b1"), fakeBrand("b2")] };
    if (/FROM open_houses/i.test(sql) && /promoted_at IS NULL/i.test(sql)) {
      if (params[0] === "b1") throw new Error("open_houses unreadable for b1");
      return { rows: [{ open_house_id: `OH-${params[0]}`, address: "9 Pine Rd", brand_id: params[0] }] };
    }
    if (/FROM open_houses/i.test(sql)) return { rows: [] };
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  automation.promoteOpenHouse = async (oh) => {
    state.promoted.push(oh.open_house_id);
    return true;
  };
  t.after(() => {
    db.query = origQuery;
    automation.promoteOpenHouse = origPromote;
  });

  await automation.runOpenHouseSweep();
  assert.deepStrictEqual(state.promoted, ["OH-b2"]);
});
