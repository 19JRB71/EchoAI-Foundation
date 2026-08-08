// Prompt 022 — Sage pre-interview public research tests.
//
// Covers the D-33 Section D battery:
//   D1  three-layer zero-local-fetch regression (static tripwire, runtime
//       outbound spy, malicious-URL-as-data)
//   D2  budget reservation refusal (zero provider calls when unaffordable)
//   D3  wall-clock deadline (honest finalize, spinner-terminal status)
//   D5  deterministic proposal ordering + intra-class tiebreak
//   D6  concurrent claim -> 409-shaped error
//   D7  honesty (empty draft, no fabrication), brands isolation, rerun
//       supersede, redaction
//
// Deadline knobs are shrunk via env BEFORE the module loads so the suite
// never waits 90 real seconds.
process.env.SAGE_RESEARCH_BUDGET_MS = "400";
process.env.SAGE_RESEARCH_FLOOR_MS = "100";
process.env.SAGE_RESEARCH_FINALIZE_RESERVE_MS = "50";

require("./dbGuard");

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

const db = require("../config/db");
const { createTestUser, deleteUser } = require("./helpers");
const sage = require("../utils/sageResearch");
const { PRICING } = require("../utils/aiUsage");

let userId;
let brandId;

// Capture production seams once so beforeEach can restore them after stubs.
const PROD_SEAMS = {
  website: sage._researchWebsite,
  publicWeb: sage._researchPublicWeb,
  reparse: sage._reparseJson,
  facebook: sage._facebookPhase,
};

before(async () => {
  userId = await createTestUser();
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name, website_url, facebook_page_url)
     VALUES ($1, 'Sage Research Test Brand', 'https://example.com', 'https://facebook.com/sagetestpage')
     RETURNING *`,
    [userId],
  );
  brandId = rows[0].brand_id;
});

after(async () => {
  await deleteUser(userId); // cascades brands + drafts
  await db.pool.end();
});

beforeEach(async () => {
  await db.query(`DELETE FROM sage_research_drafts WHERE brand_id = $1`, [brandId]);
  // Restore production seams before each test.
  sage._researchWebsite = PROD_SEAMS.website;
  sage._researchPublicWeb = PROD_SEAMS.publicWeb;
  sage._facebookPhase = PROD_SEAMS.facebook;
});

async function loadBrand() {
  const { rows } = await db.query(`SELECT * FROM brands WHERE brand_id = $1`, [brandId]);
  return rows[0];
}

async function draftByRun(runId) {
  const { rows } = await db.query(
    `SELECT * FROM sage_research_drafts WHERE run_id = $1`,
    [runId],
  );
  return rows[0];
}

function stubSeams({ website, publicWeb, facebook } = {}) {
  sage._researchWebsite = website || (async () => ({ found: false, reason: "stubbed off" }));
  sage._researchPublicWeb = publicWeb || (async () => ({ found: false, reason: "stubbed off" }));
  sage._facebookPhase = facebook || (async () => ({ candidates: [], skipped: "stubbed off" }));
}

/** Spy on every local outbound seam for the duration of fn(). */
async function withOutboundSpy(fn) {
  const calls = [];
  const origFetch = globalThis.fetch;
  const origHttpReq = http.request;
  const origHttpsReq = https.request;
  const origHttpGet = http.get;
  const origHttpsGet = https.get;
  const record = (kind) => (...args) => {
    calls.push({ kind, target: String(args[0] && (args[0].href || args[0])) });
    throw new Error(`outbound ${kind} blocked by test spy`);
  };
  globalThis.fetch = async (...args) => {
    calls.push({ kind: "fetch", target: String(args[0] && (args[0].href || args[0])) });
    throw new Error("outbound fetch blocked by test spy");
  };
  http.request = record("http.request");
  https.request = record("https.request");
  http.get = record("http.get");
  https.get = record("https.get");
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = origFetch;
    http.request = origHttpReq;
    https.request = origHttpsReq;
    http.get = origHttpGet;
    https.get = origHttpsGet;
  }
  return calls;
}

// ---------------------------------------------------------------------------
// D1 layer 1 — static import tripwire.
// ---------------------------------------------------------------------------
test("zero-fetch L1: 022 modules contain no local fetch/network primitives", () => {
  const files = [
    "../utils/sageResearch.js",
    "../controllers/sageResearchController.js",
    "../prompts/sageResearchPrompt.js",
  ];
  const banned = [
    /\bfetch\s*\(/,
    /["']node-fetch["']/,
    /["']axios["']/,
    /["']got["']/,
    /["']undici["']/,
    /\bhttp\s*\.\s*(request|get)\b/,
    /\bhttps\s*\.\s*(request|get)\b/,
    /require\(\s*["'](node:)?(http|https|net|tls|dgram|dns)["']\s*\)/,
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    for (const re of banned) {
      assert.equal(re.test(src), false, `${file} must not match ${re}`);
    }
  }
});

// ---------------------------------------------------------------------------
// D1 layer 2 — runtime outbound spy across success and failure paths.
// ---------------------------------------------------------------------------
test("zero-fetch L2: a full research run performs no local outbound requests", async () => {
  const now = new Date().toISOString();
  stubSeams({
    website: async () => ({
      found: true,
      findings: [
        { field: "phone", value: "555-0100", excerpt: "Call us at 555-0100", url: "https://example.com/contact" },
      ],
    }),
    facebook: async () => ({
      candidates: [
        { field: "business_name", value: "Sage Test Co", source: "facebook", source_url: "https://facebook.com/sagetestpage", retrieved_at: now, excerpt: "Page name: Sage Test Co" },
      ],
    }),
    publicWeb: async () => ({
      found: true,
      findings: [
        { field: "address", value: "1 Main St", excerpt: "Located at 1 Main St", url: "https://directory.example.org/listing" },
      ],
    }),
  });
  const claim = await sage.claimRun(brandId, userId);
  const calls = await withOutboundSpy(async () => {
    await sage.runResearch(await loadBrand(), { runId: claim.runId });
  });
  assert.deepEqual(calls, [], "orchestrator made local outbound requests");
  const draft = await draftByRun(claim.runId);
  assert.equal(draft.status, "complete");
});

test("zero-fetch L2: failure paths also make no local outbound requests", async () => {
  stubSeams({
    website: async () => { const e = new Error("provider down"); throw e; },
    facebook: async () => { throw new Error("graph down"); },
    publicWeb: async () => { const e = new Error("bad json"); e.aiInvalid = true; throw e; },
  });
  const claim = await sage.claimRun(brandId, userId);
  const calls = await withOutboundSpy(async () => {
    await sage.runResearch(await loadBrand(), { runId: claim.runId });
  });
  assert.deepEqual(calls, []);
  const draft = await draftByRun(claim.runId);
  assert.equal(draft.status, "empty");
});

// ---------------------------------------------------------------------------
// D1 layer 3 — malicious URLs travel only as data.
// ---------------------------------------------------------------------------
test("zero-fetch L3: malicious brand URLs are never requested locally", async () => {
  const evil = [
    "http://localhost:8080/steal",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.11.12.13/internal",
    "https://redirect.example.com/?to=http://127.0.0.1/",
  ];
  for (const url of evil) {
    const seen = [];
    stubSeams({
      website: async (_brand, websiteUrl) => {
        seen.push(websiteUrl); // URL arrives as DATA at the provider seam
        return { found: false, reason: "unreadable" };
      },
    });
    const claim = await sage.claimRun(brandId, userId);
    const brand = { ...(await loadBrand()), website_url: url, facebook_page_url: null };
    const calls = await withOutboundSpy(async () => {
      await sage.runResearch(brand, { runId: claim.runId });
    });
    assert.deepEqual(calls, [], `local request escaped for ${url}`);
    assert.deepEqual(seen, [url]);
    await db.query(`DELETE FROM sage_research_drafts WHERE brand_id = $1`, [brandId]);
  }
});

// ---------------------------------------------------------------------------
// D2 — hard $0.50 reservation.
// ---------------------------------------------------------------------------
test("reservation arithmetic: full intended plan fits under $0.50", () => {
  const total =
    sage.reservationUsd("website") +
    sage.reservationUsd("public_web") +
    sage.reservationUsd("reparse");
  assert.ok(total <= sage.AI_BUDGET_USD, `worst-case plan $${total.toFixed(4)} exceeds budget`);
});

test("reservation refusal: unaffordable call is never issued (zero provider calls)", async () => {
  const origInput = PRICING.anthropic.inputPerM;
  const origOutput = PRICING.anthropic.outputPerM;
  PRICING.anthropic.inputPerM = 1_000_000; // one reservation now >> $0.50
  PRICING.anthropic.outputPerM = 1_000_000;
  let providerCalls = 0;
  stubSeams({
    website: async () => { providerCalls += 1; return { found: false }; },
    publicWeb: async () => { providerCalls += 1; return { found: false }; },
  });
  try {
    const claim = await sage.claimRun(brandId, userId);
    await sage.runResearch(await loadBrand(), { runId: claim.runId });
    assert.equal(providerCalls, 0, "provider was called despite refused reservation");
    const draft = await draftByRun(claim.runId);
    assert.equal(draft.status, "empty");
    assert.equal(draft.stop_reason, sage.STOP_REASONS.AI_BUDGET);
  } finally {
    PRICING.anthropic.inputPerM = origInput;
    PRICING.anthropic.outputPerM = origOutput;
  }
});

test("re-parse: malformed output triggers ONE tool-free corrective call under the reparse reservation", async () => {
  let reparseCalls = 0;
  let reparseArgs = null;
  stubSeams({
    website: async () => {
      const e = new Error("AI response was not valid JSON");
      e.aiInvalid = true;
      e.rawText = 'garbage before {"found": true maybe...';
      throw e;
    },
  });
  sage._reparseJson = async (_brand, rawText, opts) => {
    reparseCalls += 1;
    reparseArgs = { rawText, opts };
    return {
      found: true,
      findings: [
        { field: "phone", value: "555-0100", excerpt: "Call 555-0100", url: "https://example.com/contact" },
      ],
    };
  };
  try {
    const claim = await sage.claimRun(brandId, userId);
    await sage.runResearch(await loadBrand(), { runId: claim.runId });
    assert.equal(reparseCalls, 1);
    assert.match(reparseArgs.rawText, /garbage before/);
    const draft = await draftByRun(claim.runId);
    assert.equal(draft.status, "complete");
    assert.equal(draft.fields.phone.value, "555-0100");
  } finally {
    sage._reparseJson = PROD_SEAMS.reparse;
  }
});

// ---------------------------------------------------------------------------
// D3 — wall-clock deadline (shrunk via env at top of file).
// ---------------------------------------------------------------------------
test("deadline: a hung provider call is abandoned and the run finalizes honestly", async () => {
  stubSeams({
    website: () => new Promise(() => {}), // hangs forever
  });
  const claim = await sage.claimRun(brandId, userId);
  const started = Date.now();
  await sage.runResearch(await loadBrand(), { runId: claim.runId });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `run did not abandon the hung call (took ${elapsed}ms)`);
  const draft = await draftByRun(claim.runId);
  assert.notEqual(draft.status, "running", "spinner-terminal state required");
  assert.equal(draft.status, "empty");
  assert.equal(draft.stop_reason, sage.STOP_REASONS.TIME_BUDGET);
});

// ---------------------------------------------------------------------------
// D5 — proposal ordering + deterministic intra-class tiebreak, contested fields.
// ---------------------------------------------------------------------------
test("proposal ordering: website beats facebook beats public_web; conflicts marked contested", () => {
  const now = new Date().toISOString();
  const mk = (value, source, url) => ({
    field: "phone", value, source, source_url: url, retrieved_at: now, excerpt: `says ${value}`,
  });
  const candidates = [
    mk("555-0300", "public_web", "https://dir.example.org/x"),
    mk("555-0200", "facebook", "https://facebook.com/p"),
    mk("555-0100", "website", "https://example.com/contact"),
  ];
  const fields = sage.mergeCandidates(candidates);
  assert.equal(fields.phone.value, "555-0100");
  assert.equal(fields.phone.conflict, true);
  assert.equal(fields.phone.confidence, "low");
  assert.equal(fields.phone.alternatives.length, 2);
  const altValues = fields.phone.alternatives.map((a) => a.value).sort();
  assert.deepEqual(altValues, ["555-0200", "555-0300"]);
});

test("intra-class tiebreak is deterministic regardless of input order", () => {
  const now = new Date().toISOString();
  const a = { field: "email", value: "b@example.com", source: "public_web", source_url: "https://bbb.example.org/x", retrieved_at: now, excerpt: "b@example.com" };
  const b = { field: "email", value: "a@example.com", source: "public_web", source_url: "https://aaa.example.org/x", retrieved_at: now, excerpt: "a@example.com" };
  const one = sage.mergeCandidates([a, b]);
  const two = sage.mergeCandidates([b, a]);
  // Tiebreak: same class -> source_url ascending, so aaa.example.org wins.
  assert.equal(one.email.value, "a@example.com");
  assert.deepEqual(one.email, two.email);
});

test("corroborating sources agree: no conflict, ordered sources retained", () => {
  const now = new Date().toISOString();
  const fields = sage.mergeCandidates([
    { field: "address", value: "1 Main St", source: "public_web", source_url: "https://dir.example.org/x", retrieved_at: now, excerpt: "1 Main St" },
    { field: "address", value: "1 main st", source: "website", source_url: "https://example.com/", retrieved_at: now, excerpt: "1 Main St" },
  ]);
  assert.equal(fields.address.conflict, false);
  assert.equal(fields.address.confidence, "high");
  assert.equal(fields.address.sources.length, 2);
  assert.equal(fields.address.sources[0].source, "website"); // primary evidence first
});

// ---------------------------------------------------------------------------
// Provenance is mandatory — no field without evidence.
// ---------------------------------------------------------------------------
test("candidates without provenance are dropped, never patched", () => {
  const now = new Date().toISOString();
  const fields = sage.mergeCandidates([
    { field: "phone", value: "555-0100", source: "website", source_url: null, retrieved_at: now, excerpt: "x" }, // no url
    { field: "email", value: "a@b.com", source: "website", source_url: "https://example.com", retrieved_at: now, excerpt: "" }, // no excerpt
    { field: "hours", value: "9-5", source: "inferred", source_url: "https://example.com", retrieved_at: now, excerpt: "9-5" }, // inferred w/o basis
    { field: "not_a_field", value: "x", source: "website", source_url: "https://example.com", retrieved_at: now, excerpt: "x" }, // unknown key
  ]);
  assert.deepEqual(fields, {});
});

// ---------------------------------------------------------------------------
// D6 — concurrency: second claim is refused.
// ---------------------------------------------------------------------------
test("concurrent claim: second start is refused while a run holds the claim", async () => {
  await sage.claimRun(brandId, userId);
  await assert.rejects(
    () => sage.claimRun(brandId, userId),
    (err) => err.inProgress === true,
  );
});

// ---------------------------------------------------------------------------
// D7 — honesty, isolation, rerun supersede, redaction, stale sweep, finalize guard.
// ---------------------------------------------------------------------------
test("honest empty: nothing found -> empty draft with the honest summary, zero fabricated fields", async () => {
  stubSeams();
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId });
  const draft = await draftByRun(claim.runId);
  assert.equal(draft.status, "empty");
  assert.deepEqual(draft.fields, {});
  assert.match(draft.summary, /could not find much publicly/i);
});

test("brands isolation: a research run never mutates the brands row", async () => {
  const beforeRow = await loadBrand();
  const now = new Date().toISOString();
  stubSeams({
    website: async () => ({ found: true, findings: [{ field: "description", value: "We store things", excerpt: "We store things", url: "https://example.com/about" }] }),
    facebook: async () => ({ candidates: [{ field: "phone", value: "555-0100", source: "facebook", source_url: "https://facebook.com/p", retrieved_at: now, excerpt: "555-0100" }] }),
  });
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId });
  assert.deepEqual(await loadBrand(), beforeRow);
});

test("rerun supersedes: exactly one active draft after a second run", async () => {
  stubSeams({
    website: async () => ({ found: true, findings: [{ field: "phone", value: "555-0100", excerpt: "555-0100", url: "https://example.com/" }] }),
  });
  const c1 = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: c1.runId });
  const c2 = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: c2.runId });
  const first = await draftByRun(c1.runId);
  const second = await draftByRun(c2.runId);
  assert.equal(first.status, "superseded");
  assert.equal(second.status, "complete");
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM sage_research_drafts
      WHERE brand_id = $1 AND status IN ('complete','partial','empty')`,
    [brandId],
  );
  assert.equal(rows[0].n, 1);
});

test("redaction: persisted URLs lose queries/credentials; error text loses tokens", () => {
  assert.equal(
    sage.redactUrl("https://user:pass@example.com:8443/path/page?token=abc#frag"),
    "https://example.com:8443/path/page",
  );
  assert.equal(sage.redactUrl("javascript:alert(1)"), null);
  assert.equal(sage.redactUrl("not a url"), null);
  const red = sage.redactErrorText(
    "fetch https://api.example.com/v1?key=SECRET failed, authorization: Bearer abc123",
  );
  assert.ok(!red.includes("SECRET"));
  assert.ok(!red.includes("abc123"));
});

test("stale claim sweep: an abandoned running claim is rescued and a new run can start", async () => {
  const { rows } = await db.query(
    `INSERT INTO sage_research_drafts (brand_id, user_id, run_id, status, started_at)
     VALUES ($1, $2, gen_random_uuid(), 'running', NOW() - INTERVAL '11 minutes')
     RETURNING run_id`,
    [brandId, userId],
  );
  assert.ok(rows[0].run_id);
  const claim = await sage.claimRun(brandId, userId); // sweeps, then claims
  assert.ok(claim.runId);
});

test("finalize guard: finalizing a non-running run is a no-op (returns false)", async () => {
  stubSeams();
  const claim = await sage.claimRun(brandId, userId);
  await sage.runResearch(await loadBrand(), { runId: claim.runId }); // finalizes to empty
  const again = await sage.finalizeRun({
    runId: claim.runId,
    brandId,
    status: "complete",
    fields: { phone: { value: "fake" } },
  });
  assert.equal(again, false);
  const draft = await draftByRun(claim.runId);
  assert.equal(draft.status, "empty");
  assert.deepEqual(draft.fields, {});
});

test("stop_reason enumeration is the fixed contract set", () => {
  assert.deepEqual(
    Object.values(sage.STOP_REASONS).sort(),
    ["ai_blocked", "ai_budget", "db_error", "malformed_output", "no_public_info", "provider_error", "stale_claim", "time_budget"],
  );
});

test("endpoints: owner-scoped brand lookup runs against the real schema (start 202, poll, foreign brand 404)", async () => {
  // Regression for a staging 500: the controller must only select columns
  // that actually exist (industry lives on users, not brands).
  const controller = require("../controllers/sageResearchController");
  stubSeams();
  const call = (fn, params, user) =>
    new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(body) { resolve({ status: this.statusCode, body }); },
      };
      fn({ params, user }, res, reject);
    });

  const started = await call(controller.startResearch, { brandId }, { userId });
  assert.equal(started.status, 202);
  assert.ok(started.body.runId);
  await controller.lastRunPromise;

  const polled = await call(controller.getResearch, { brandId }, { userId });
  assert.equal(polled.status, 200);
  assert.equal(polled.body.draft.status, "empty");

  // Another user's token must not see or start research on this brand.
  const stranger = await createTestUser();
  try {
    const denied = await call(controller.startResearch, { brandId }, { userId: stranger });
    assert.equal(denied.status, 404);
  } finally {
    await deleteUser(stranger);
  }
});

test("facebook page ref extraction handles usernames, profile.php and rejects non-facebook", () => {
  assert.equal(sage.pageRefFromUrl("https://facebook.com/southdixiestorage"), "southdixiestorage");
  assert.equal(sage.pageRefFromUrl("https://www.facebook.com/profile.php?id=12345"), "12345");
  assert.equal(sage.pageRefFromUrl("https://evil.com/facebook.com/x"), null);
  assert.equal(sage.pageRefFromUrl("not a url"), null);
});
