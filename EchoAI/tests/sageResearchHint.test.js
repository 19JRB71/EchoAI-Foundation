/**
 * Prompt 023 (I-38a) — disambiguation hint tests.
 *
 * "A disambiguation hint may improve candidate retrieval; it does not elevate
 *  confidence or establish source ownership by itself."
 *
 * Covers: hint reaches ONLY retrieval input (public-web hints object), the
 * no-hint path is byte-identical to pre-023 behavior (same hints object, no
 * hint note), sanitization bounds, run-level persistence of the used hint in
 * the draft summary (never in field sources/provenance), and no effect on
 * confidence/source classification/ordering.
 */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

require("./dbGuard");
const db = require("../config/db");
const { createTestUser, deleteUser } = require("./helpers");
const sage = require("../utils/sageResearch");

let userId;
let brandId;

const PROD_SEAMS = {
  website: sage._researchWebsite,
  publicWeb: sage._researchPublicWeb,
  facebook: sage._facebookPhase,
};

before(async () => {
  userId = await createTestUser();
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Hint Test Brand') RETURNING brand_id`,
    [userId],
  );
  brandId = rows[0].brand_id;
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

beforeEach(async () => {
  await db.query(`DELETE FROM sage_research_drafts WHERE brand_id = $1`, [brandId]);
  sage._researchWebsite = PROD_SEAMS.website;
  sage._researchPublicWeb = PROD_SEAMS.publicWeb;
  sage._facebookPhase = PROD_SEAMS.facebook;
});

async function loadBrand() {
  const { rows } = await db.query(`SELECT * FROM brands WHERE brand_id = $1`, [brandId]);
  return rows[0];
}

async function draftByRun(runId) {
  const { rows } = await db.query(`SELECT * FROM sage_research_drafts WHERE run_id = $1`, [runId]);
  return rows[0];
}

function stubPhases(publicWebImpl) {
  const publicWebCalls = [];
  sage._researchWebsite = async () => ({ found: false, reason: "stubbed off" });
  sage._facebookPhase = async () => ({ candidates: [], skipped: "stubbed off" });
  sage._researchPublicWeb = async (brand, hints, opts) => {
    publicWebCalls.push({ hints });
    return publicWebImpl
      ? publicWebImpl(brand, hints, opts)
      : {
          found: true,
          findings: [
            {
              field: "description",
              value: "A hinted business",
              excerpt: "A hinted business",
              url: "https://directory.example/listing",
            },
          ],
        };
  };
  return publicWebCalls;
}

test("hint threads into public-web retrieval input only", async () => {
  const calls = stubPhases();
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId, locationHint: "  Kalona,   Iowa " });
  assert.equal(calls.length, 1);
  // Sanitized (whitespace collapsed) and passed as its own labelled input.
  assert.equal(calls[0].hints.locationHint, "Kalona, Iowa");
  const draft = await draftByRun(claim.runId);
  // Run-level persistence: the summary honestly records the hinted retrieval.
  assert.match(draft.summary, /owner-supplied location hint used \("Kalona, Iowa"\)/);
  // NEVER field-level evidence: sources/provenance carry no hint text.
  const f = draft.fields.description;
  assert.equal(f.value, "A hinted business");
  assert.ok(!JSON.stringify(f.sources).includes("Kalona"), "hint must not enter field sources");
});

test("no-hint path regresses identical: same hints shape, no hint note", async () => {
  const calls = stubPhases();
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId });
  assert.equal(calls.length, 1);
  // Pre-023 hints keys plus locationHint === null (falsy → prompt line omitted).
  assert.deepEqual(Object.keys(calls[0].hints).sort(), [
    "facebookPageUrl",
    "industry",
    "locationHint",
    "websiteUrl",
  ]);
  assert.equal(calls[0].hints.locationHint, null);
  const draft = await draftByRun(claim.runId);
  assert.ok(!/location hint/.test(draft.summary || ""), "no hint note without a hint");
});

test("unusable hints (empty / oversized / non-string) are dropped, not truncated or guessed", async () => {
  const calls = stubPhases();
  for (const bad of ["   ", "x".repeat(121), 42, { city: "X" }]) {
    const claim = await sage.claimRun(brandId, userId);
    await sage.runResearch(await loadBrand(), { runId: claim.runId, locationHint: bad });
    await db.query(`DELETE FROM sage_research_drafts WHERE brand_id = $1`, [brandId]);
  }
  assert.ok(calls.every((c) => c.hints.locationHint === null));
});

test("hint does not alter confidence, source classification, or proposal ordering", async () => {
  stubPhases();
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId, locationHint: "Kalona, Iowa" });
  const draft = await draftByRun(claim.runId);
  const f = draft.fields.description;
  // Single public-web source with no corroboration: exactly the pre-023
  // classification — source 'public_web', confidence never elevated to high.
  assert.equal(f.sources[0].source, "public_web");
  assert.notEqual(f.confidence, "high");
  // Merge/ordering constants untouched.
  assert.deepEqual([...sage.PROPOSAL_ORDER], ["website", "facebook", "public_web", "inferred"]);
});

test("hinted EMPTY run persists the hint note on the draft (I-38a: every terminal status)", async () => {
  // Public web runs (hint used) but finds nothing → fieldCount 0 → empty.
  const calls = stubPhases(async () => ({ found: false, reason: "nothing found" }));
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId, locationHint: "Kalona, Iowa" });
  assert.equal(calls.length, 1);
  const draft = await draftByRun(claim.runId);
  assert.equal(draft.status, "empty");
  assert.match(
    draft.summary,
    /owner-supplied location hint used \("Kalona, Iowa"\)/,
    "an empty run must still record that the hint was used",
  );
});

test("the governing sentence is present verbatim in the research source", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("../utils/sageResearch.js"), "utf8");
  assert.ok(
    src.includes(
      "A disambiguation hint may improve candidate retrieval; it does not",
    ) && src.includes("elevate confidence or establish source ownership by itself."),
  );
});
