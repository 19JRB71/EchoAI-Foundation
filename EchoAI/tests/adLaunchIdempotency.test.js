// Prompt 033 (I-32, owner rulings D-40 + D-41) — Autopilot launch idempotency.
//
// Section J test plan: DB-backed, through the real spine/executeExternal
// seams, Facebook provider MOCKED (never a real Graph call), per-object
// provider call counters asserted INDEPENDENTLY (never one atomic mock count).
//
//   J1  frozen deterministic-ID vectors (namespace + algorithm pinned)
//   J2  same intent stability across re-entry paths
//   J3  new-intent inverse (new item → new key → new chain permitted)
//   J4  claim committed, zero execution evidence → exactly one execution
//   J5  pre-provider terminal failure: Case A retryable / Case B campaigns row blocks
//   J6  campaigns-row-present gate (index availability irrelevant)
//   J7  reconciled 'interrupted' row still blocks (vacated index ≠ clean)
//   J8  partial provider IDs → zero provider calls (each partial combo)
//   J9  acknowledgement-loss per object → nothing recreated
//   J10 claim/commit regression (original I-32 class) — counts stay one
//   J11 concurrent approval — one winner, one chain
//   J12 task-attempt semantics — same source id, incremented attempt
//   J13 source-uniqueness / dedup backstop not weakened; dedup loser records nothing
//   J14 consumer safety — approved + no campaigns row never implies a live campaign
//   J15 governing re-execution rule verbatim in code + docs

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// Stub the learning-engine signal recorder BEFORE requiring the controller
// (it destructures recordSignal at require time). Signals are fire-and-forget
// and would otherwise race the pool teardown.
const learningEngine = require("../utils/learningEngine");
learningEngine.recordSignal = async () => null;

const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt } = require("../utils/encryption");
const taskSpine = require("../utils/taskSpine");
const adLaunchSpine = require("../utils/adLaunchSpine");
const { launchFacebookCampaign } = require("../controllers/campaignController");
const autopilot = require("../controllers/autopilotController");

const {
  deriveAutopilotLaunchIntentId,
  AUTOPILOT_LAUNCH_INTENT_NAMESPACE,
  classifyLaunchEvidence,
} = adLaunchSpine;

let userId;
let brandId; // fully launch-ready brand
let noLinkBrandId; // brand with no ad_link_url → pre-provider failure
let batchId;
const madeItems = [];

// ---- Graph API fetch mock ---------------------------------------------------
// Counts provider-object CREATES independently. ackLossPath simulates
// acknowledgement loss: the provider-side object IS created (counted), but
// the response is lost (the call throws).
const realFetch = global.fetch;
let counts; // { campaigns, adsets, adcreatives, ads } — POST creates only
let failOnPath = null; // POST path suffix that fails WITHOUT creating
let ackLossPath = null; // POST path suffix that creates THEN fails
let idPrefix = "ai";
let seq = 0; // unique Facebook ids per created object (no cross-test bleed)
let lastCampaignFbId = null;
let createdAdsByCampaign = {};

function objectKeyOf(pathName) {
  if (pathName.endsWith("/campaigns")) return "campaigns";
  if (pathName.endsWith("/adsets")) return "adsets";
  if (pathName.endsWith("/adcreatives")) return "adcreatives";
  if (pathName.endsWith("/ads")) return "ads";
  return null;
}

function installFetchMock() {
  counts = { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith("graph.facebook.com")) {
      throw new Error(`Unexpected non-Graph fetch in test: ${u.hostname}`);
    }
    const pathName = u.pathname.replace(/^\/v[\d.]+/, "");
    const method = opts.method || "GET";

    if (method === "GET") {
      if (pathName.endsWith("/ads")) {
        // The /ads list serves BOTH the duplicate guard (before creating the
        // ad) and the verification read-back (after). Return the created ads
        // for THIS campaign only — a fresh campaign must see an empty list.
        const fbCampaignId = pathName.slice(1).replace(/\/ads$/, "");
        const list = createdAdsByCampaign[fbCampaignId] || [];
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ data: list.map((id) => ({ id, status: "PAUSED", effective_status: "PAUSED" })) }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ id: pathName.slice(1), status: "PAUSED", effective_status: "PAUSED" }),
      };
    }

    const key = objectKeyOf(pathName);
    if (failOnPath && pathName.endsWith(failOnPath)) {
      // Plain failure: no provider object created.
      return {
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ error: { message: "Simulated Graph failure", code: 100 } }),
      };
    }
    if (key) counts[key] += 1; // the provider-side object now EXISTS
    if (ackLossPath && pathName.endsWith(ackLossPath)) {
      // Acknowledgement loss: created remotely, response lost locally.
      return {
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ error: { message: "Simulated acknowledgement loss", code: 2 } }),
      };
    }
    let id = "unknown";
    if (key === "campaigns") {
      id = `cmp_${idPrefix}_${++seq}`;
      lastCampaignFbId = id;
      createdAdsByCampaign[id] = createdAdsByCampaign[id] || [];
    } else if (key === "adsets") id = `as_${idPrefix}_${++seq}`;
    else if (key === "adcreatives") id = `cr_${idPrefix}_${++seq}`;
    else if (key === "ads") {
      id = `ad_${idPrefix}_${++seq}`;
      if (lastCampaignFbId) (createdAdsByCampaign[lastCampaignFbId] = createdAdsByCampaign[lastCampaignFbId] || []).push(id);
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id }) };
  };
}

// ---- harness helpers --------------------------------------------------------

function resStub() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

async function approve(itemId, body = {}) {
  const res = resStub();
  await autopilot.approveItem({ user: { userId }, params: { itemId }, body }, res);
  return res;
}

async function makeAdItem({ status = "pending", brand = brandId, budget = 5 } = {}) {
  const { rows } = await db.query(
    `INSERT INTO autopilot_batch_items
       (batch_id, position, item_type, platform, post_content, ad_headline, ad_daily_budget, status)
     VALUES ($1, 1, 'ad', 'facebook', 'Idempotency test primary text', 'Idempotency test ad', $2, $3)
     RETURNING *`,
    [batchId, budget, status]
  );
  // Items live on the batch's brand; for the no-link brand we retarget the
  // batch row is shared, so instead point the item's brand via its batch —
  // approveItem reads brand from the ITEM's batch brand. We keep one batch
  // per brand instead.
  madeItems.push(rows[0].item_id);
  return rows[0];
}

let noLinkBatchId;
async function makeNoLinkAdItem() {
  const { rows } = await db.query(
    `INSERT INTO autopilot_batch_items
       (batch_id, position, item_type, platform, post_content, ad_headline, ad_daily_budget, status)
     VALUES ($1, 1, 'ad', 'facebook', 'Pre-provider failure text', 'Pre-provider ad', 5, 'pending')
     RETURNING *`,
    [noLinkBatchId]
  );
  madeItems.push(rows[0].item_id);
  return rows[0];
}

function keyOf(itemId) {
  return `ad_launch:${deriveAutopilotLaunchIntentId(itemId)}`;
}

async function ledgerRows(itemId) {
  const { rows } = await db.query("SELECT * FROM external_actions WHERE idempotency_key = $1", [keyOf(itemId)]);
  return rows;
}

async function taskOf(itemId) {
  return taskSpine.findTaskBySource({
    taskType: "ad_launch",
    sourceType: "campaign",
    sourceId: deriveAutopilotLaunchIntentId(itemId),
  });
}

async function itemRow(itemId) {
  const { rows } = await db.query("SELECT * FROM autopilot_batch_items WHERE item_id = $1", [itemId]);
  return rows[0];
}

before(async () => {
  userId = await createTestUser();
  const b = await db.query(
    `INSERT INTO brands (user_id, brand_name, facebook_page_id, ad_link_url)
     VALUES ($1, 'Idempotency Brand', '1500123456789', 'https://example.test/landing')
     RETURNING brand_id`,
    [userId]
  );
  brandId = b.rows[0].brand_id;
  const b2 = await db.query(
    `INSERT INTO brands (user_id, brand_name, facebook_page_id)
     VALUES ($1, 'Idempotency NoLink Brand', '1500123456789')
     RETURNING brand_id`,
    [userId]
  );
  noLinkBrandId = b2.rows[0].brand_id;
  await db.query(
    `INSERT INTO api_integrations
       (user_id, platform, api_token_encrypted, account_ref, facebook_pages, connection_status)
     VALUES ($1, 'facebook', $2, 'act_777033', $3::jsonb, 'connected')
     ON CONFLICT (user_id, platform) DO UPDATE
       SET api_token_encrypted = EXCLUDED.api_token_encrypted,
           account_ref = EXCLUDED.account_ref,
           facebook_pages = EXCLUDED.facebook_pages,
           connection_status = 'connected'`,
    [userId, encrypt(`token-for-${userId}`), JSON.stringify([{ id: "1500123456789", name: "Idem Page" }])]
  );
  const bat = await db.query(
    `INSERT INTO autopilot_batches (brand_id, user_id, week_start, status)
     VALUES ($1, $2, CURRENT_DATE, 'ready') RETURNING batch_id`,
    [brandId, userId]
  );
  batchId = bat.rows[0].batch_id;
  const bat2 = await db.query(
    `INSERT INTO autopilot_batches (brand_id, user_id, week_start, status)
     VALUES ($1, $2, CURRENT_DATE, 'ready') RETURNING batch_id`,
    [noLinkBrandId, userId]
  );
  noLinkBatchId = bat2.rows[0].batch_id;
});

after(async () => {
  global.fetch = realFetch;
  for (const itemId of madeItems) {
    await db.query("DELETE FROM external_actions WHERE idempotency_key = $1", [keyOf(itemId)]);
  }
  for (const bid of [brandId, noLinkBrandId]) {
    const { rows } = await db.query("SELECT task_id FROM agent_tasks WHERE brand_id = $1", [bid]);
    await db.query("ALTER TABLE agent_task_events DISABLE TRIGGER trg_agent_task_events_immutable");
    for (const r of rows) await db.query("DELETE FROM agent_task_events WHERE task_id = $1", [r.task_id]);
    await db.query("ALTER TABLE agent_task_events ENABLE TRIGGER trg_agent_task_events_immutable");
    await db.query("DELETE FROM agent_tasks WHERE brand_id = $1", [bid]);
    await db.query("ALTER TABLE external_proofs DISABLE TRIGGER trg_external_proofs_immutable");
    await db.query("DELETE FROM external_proofs WHERE brand_id = $1", [bid]);
    await db.query("ALTER TABLE external_proofs ENABLE TRIGGER trg_external_proofs_immutable");
  }
  await db.query("DELETE FROM campaigns WHERE user_id = $1", [userId]);
  await deleteUser(userId);
  await db.pool.end();
});

beforeEach(() => {
  installFetchMock();
  failOnPath = null;
  ackLossPath = null;
  idPrefix = "ai";
});

// ---------------------------------------------------------------------------
// J1 — frozen deterministic-ID vectors. These pin the namespace, algorithm
// (RFC 4122 UUID v5 / SHA-1), byte ordering, and formatting. If ANY of those
// silently changes, existing items would mint new keys and reopen I-32 —
// this test must fail first.
// ---------------------------------------------------------------------------

test("J1: frozen derivation vectors — namespace and algorithm pinned", () => {
  assert.equal(AUTOPILOT_LAUNCH_INTENT_NAMESPACE, "c95d9b57-9a42-4e1b-8f6a-033a1e32d41b");
  const VECTORS = [
    ["00000000-0000-4000-8000-000000000001", "ec57e22b-0242-5489-b3a2-8681167f8669"],
    ["11111111-2222-4333-8444-555555555555", "4cd0f0b2-57ad-5bf4-bdda-3ed10e799e08"],
    ["a3bb189e-8bf9-3888-9912-ace4e6543002", "39dbdebc-9212-534c-9d0e-4bfc8d24a10d"],
  ];
  for (const [input, expected] of VECTORS) {
    assert.equal(deriveAutopilotLaunchIntentId(input), expected, `vector ${input}`);
    assert.equal(deriveAutopilotLaunchIntentId(input), expected, "same input, same output (repeat)");
  }
  // v5 shape: version nibble 5, RFC variant.
  const out = deriveAutopilotLaunchIntentId("00000000-0000-4000-8000-000000000001");
  assert.match(out, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ---------------------------------------------------------------------------
// J2 + J4 + J10 — happy path, then re-entry: one chain ever.
// ---------------------------------------------------------------------------

test("J2/J4/J10: approve launches once with derived key; every re-entry is blocked with zero provider calls", async () => {
  const item = await makeAdItem();
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);

  const res = await approve(item.item_id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.launch.campaignId, intentId, "campaigns.campaign_id IS the derived intent id");
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });

  const ledger = await ledgerRows(item.item_id);
  assert.equal(ledger.length, 1, "exactly one ledger row under the derived key");
  assert.equal(ledger[0].status, "succeeded");

  const row = await itemRow(item.item_id);
  assert.equal(row.status, "approved");
  assert.equal(row.campaign_id, intentId, "post-success campaign_id write (after campaigns row exists)");

  // Re-entry (HTTP retry / double click / worker retry): evidence-dirty.
  const again = await approve(item.item_id);
  assert.equal(again.statusCode, 409);
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 }, "no object recreated");

  const task = await taskOf(item.item_id);
  assert.equal(task.status, "COMPLETED");
  assert.equal(task.attempt, 1);
});

test("J4: claim committed, zero execution evidence (crash before ledger) → re-entry executes exactly once, same key", async () => {
  const item = await makeAdItem({ status: "approved" }); // TX1 committed, nothing else ever happened
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);

  const gate = await classifyLaunchEvidence({ intentId });
  assert.equal(gate.clean, true, `expected clean, got: ${gate.reasons}`);

  const res = await approve(item.item_id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.launch.campaignId, intentId);
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });
  assert.equal((await ledgerRows(item.item_id))[0].idempotency_key, keyOf(item.item_id));

  const again = await approve(item.item_id);
  assert.equal(again.statusCode, 409);
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });
});

// ---------------------------------------------------------------------------
// J3 — new-intent inverse: a genuinely new item must NOT be suppressed.
// ---------------------------------------------------------------------------

test("J3: new item → new derived id/key → new chain permitted", async () => {
  const a = await makeAdItem();
  const b = await makeAdItem();
  assert.notEqual(deriveAutopilotLaunchIntentId(a.item_id), deriveAutopilotLaunchIntentId(b.item_id));

  assert.equal((await approve(a.item_id)).statusCode, 200);
  assert.equal((await approve(b.item_id)).statusCode, 200);
  assert.deepEqual(counts, { campaigns: 2, adsets: 2, adcreatives: 2, ads: 2 }, "two intents, two chains");
  assert.notEqual((await ledgerRows(a.item_id))[0].idempotency_key, (await ledgerRows(b.item_id))[0].idempotency_key);
});

// ---------------------------------------------------------------------------
// J5 + J12 — pre-provider terminal failure.
// ---------------------------------------------------------------------------

test("J5 Case A / J12: pre-provider failure (no ledger row, no ids, no campaigns row) → retry allowed, same source, attempt incremented", async () => {
  const item = await makeNoLinkAdItem();
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);

  const first = await approve(item.item_id);
  assert.notEqual(first.statusCode, 200, "launch must fail without an ad destination");
  assert.deepEqual(counts, { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 }, "provider never reached");
  assert.equal((await ledgerRows(item.item_id)).length, 0, "pre-provider failure leaves no ledger row");
  const camp0 = await db.query("SELECT 1 FROM campaigns WHERE campaign_id = $1", [intentId]);
  assert.equal(camp0.rows.length, 0, "no campaigns row for a pre-provider failure");

  // TX1 stayed committed: approved, and campaign_id remains NULL (never a
  // pre-execution write — the FK and post-success semantics are untouched).
  const row = await itemRow(item.item_id);
  assert.equal(row.status, "approved");
  assert.equal(row.campaign_id, null);

  const t1 = await taskOf(item.item_id);
  assert.ok(taskSpine.FAILURE_STATES.includes(t1.status), `failure state, got ${t1.status}`);
  assert.equal(t1.attempt, 1);

  // Fix the brand, re-enter: evidence-clean → executes once, attempt 2,
  // SAME source id — never a new source identity, never attempt-1 collision.
  await db.query("UPDATE brands SET ad_link_url = 'https://example.test/fixed' WHERE brand_id = $1", [noLinkBrandId]);
  const second = await approve(item.item_id);
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });
  const t2 = await taskOf(item.item_id);
  assert.equal(t2.source_id, intentId, "source id unchanged");
  assert.equal(t2.attempt, 2, "incremented attempt under D-24 G");
  assert.equal(t2.status, "COMPLETED");
  await db.query("UPDATE brands SET ad_link_url = NULL WHERE brand_id = $1", [noLinkBrandId]);
});

test("J5 Case B: a launch_failed campaigns row blocks automatic re-execution (Prompt 031 boundary)", async () => {
  const item = await makeAdItem({ status: "approved" });
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);
  await db.query(
    `INSERT INTO campaigns (campaign_id, brand_id, user_id, campaign_name, budget, status)
     VALUES ($1, $2, $3, 'J5B failed launch', 5, 'launch_failed')`,
    [intentId, brandId, userId]
  );
  const res = await approve(item.item_id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "already_executed");
  assert.ok(res.body.evidence.some((r) => r.includes("campaigns_row_launch_failed")), String(res.body.evidence));
  assert.deepEqual(counts, { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 }, "ZERO provider calls");
});

// ---------------------------------------------------------------------------
// J6 — campaigns-row-present gate, regardless of index availability.
// ---------------------------------------------------------------------------

test("J6: ANY campaigns row for the derived intent blocks execution even with no ledger row at all", async () => {
  const item = await makeAdItem({ status: "approved" });
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);
  await db.query(
    `INSERT INTO campaigns (campaign_id, brand_id, user_id, campaign_name, budget, status)
     VALUES ($1, $2, $3, 'J6 orphan row', 5, 'created_paused')`,
    [intentId, brandId, userId]
  );
  const res = await approve(item.item_id);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(counts, { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 });
});

// ---------------------------------------------------------------------------
// J7 — reconciled 'interrupted' row: vacates the active-key index, must
// STILL block (evidence-gated, never index-gated).
// ---------------------------------------------------------------------------

test("J7: reconciled interrupted ledger row blocks re-entry with zero provider calls", async () => {
  const item = await makeAdItem({ status: "approved" });
  await db.query(
    `INSERT INTO external_actions (idempotency_key, provider, action, brand_id, user_id, attempt, status, classification, error, started_at, finished_at)
     VALUES ($1, 'facebook', 'ad_launch', $2, $3, 1, 'failed', 'interrupted', 'process died mid-flight', NOW() - INTERVAL '1 hour', NOW())`,
    [keyOf(item.item_id), brandId, userId]
  );
  // The active-key partial unique index covers in_progress|succeeded only —
  // this row has vacated it. The evidence gate must still say DIRTY.
  const res = await approve(item.item_id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "already_executed");
  assert.ok(res.body.evidence.some((r) => r.includes("interrupted")), String(res.body.evidence));
  assert.deepEqual(counts, { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 });
});

// ---------------------------------------------------------------------------
// J8 — every partial-ID combination blocks. One real mid-chain run plus the
// classifier over each seeded partial bag.
// ---------------------------------------------------------------------------

test("J8: mid-chain failure records partial ids; re-entry makes ZERO provider calls (campaign never recreated)", async () => {
  const item = await makeAdItem();
  failOnPath = "/adsets"; // campaign created, ad set fails
  const first = await approve(item.item_id);
  assert.notEqual(first.statusCode, 200);
  assert.deepEqual(counts, { campaigns: 1, adsets: 0, adcreatives: 0, ads: 0 });

  failOnPath = null;
  const again = await approve(item.item_id);
  assert.equal(again.statusCode, 409);
  assert.deepEqual(counts, { campaigns: 1, adsets: 0, adcreatives: 0, ads: 0 }, "partial chain never resumed or recreated");

  const task = await taskOf(item.item_id);
  assert.ok(["EXTERNAL_FAILURE", "MANUAL_REVIEW"].includes(task.status), task.status);
});

test("J8: classifier marks every partial-ID combination dirty", async () => {
  const combos = [
    { campaignId: "cmp_1", adSetId: null, creativeId: null, adId: null },
    { campaignId: "cmp_1", adSetId: "as_1", creativeId: null, adId: null },
    { campaignId: "cmp_1", adSetId: "as_1", creativeId: "cr_1", adId: null },
    { campaignId: "cmp_1", adSetId: "as_1", creativeId: "cr_1", adId: "ad_1" }, // all four, bookkeeping incomplete
  ];
  for (const [i, partial] of combos.entries()) {
    const item = await makeAdItem({ status: "approved" });
    const intentId = deriveAutopilotLaunchIntentId(item.item_id);
    await taskSpine.createTask({
      brandId,
      userId,
      taskType: "ad_launch",
      sourceType: "campaign",
      sourceId: intentId,
      title: `J8 combo ${i}`,
      status: "APPROVED",
      actor: "system:test",
      meta: { partialChain: partial },
    });
    const gate = await classifyLaunchEvidence({ intentId });
    assert.equal(gate.clean, false, `combo ${i} must be dirty`);
    const res = await approve(item.item_id);
    assert.equal(res.statusCode, 409, `combo ${i} blocked`);
    assert.deepEqual(counts, { campaigns: 0, adsets: 0, adcreatives: 0, ads: 0 }, `combo ${i} zero calls`);
  }
});

// ---------------------------------------------------------------------------
// J9 — acknowledgement loss per object: the provider-side object EXISTS but
// the success response was lost. Re-entry must not recreate anything.
// ---------------------------------------------------------------------------

for (const obj of ["campaigns", "adsets", "adcreatives", "ads"]) {
  test(`J9: acknowledgement loss on ${obj} → re-entry blocked, every per-object count stays <= 1`, async () => {
    const item = await makeAdItem();
    ackLossPath = `/${obj}`;
    const first = await approve(item.item_id);
    assert.notEqual(first.statusCode, 200, "the lost acknowledgement surfaces as a failure");
    const after1 = { ...counts };
    assert.equal(after1[obj], 1, `${obj} was created provider-side exactly once`);

    ackLossPath = null;
    const again = await approve(item.item_id);
    assert.equal(again.statusCode, 409, "evidence-dirty (ledger row exists) — no automatic re-execution");
    assert.deepEqual(counts, after1, "no provider object of any type recreated");
    for (const k of Object.keys(counts)) {
      assert.ok(counts[k] <= 1, `${k} count ${counts[k]} exceeds 1`);
    }
  });
}

// ---------------------------------------------------------------------------
// J11 — concurrent approval.
// ---------------------------------------------------------------------------

test("J11: concurrent approval of a pending item — one winner, one chain", async () => {
  const item = await makeAdItem();
  const [r1, r2] = await Promise.all([approve(item.item_id), approve(item.item_id)]);
  const codes = [r1.statusCode, r2.statusCode].sort();
  assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one winner: ${codes}`);
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });
});

test("J11: concurrent re-entry on an evidence-clean approved item — active-key backstop serializes to one chain, loser records nothing", async () => {
  const item = await makeAdItem({ status: "approved" });
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);
  const [r1, r2] = await Promise.all([approve(item.item_id), approve(item.item_id)]);
  const winners = [r1, r2].filter((r) => r.statusCode === 200);
  assert.equal(winners.length, 1, `exactly one winner: ${r1.statusCode}/${r2.statusCode}`);
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });
  // The dedup loser must not have poisoned the winner's trail: exactly one
  // campaigns row, and it is the SUCCESS row.
  const camp = await db.query("SELECT status FROM campaigns WHERE campaign_id = $1", [intentId]);
  assert.equal(camp.rows.length, 1);
  assert.equal(camp.rows[0].status, "created_paused", "no launch_failed row from the dedup loser");
});

// ---------------------------------------------------------------------------
// J13 — dedup/source-uniqueness backstop not weakened.
// ---------------------------------------------------------------------------

test("J13: direct duplicate fire of the same intent dedups with zero recording; winner trail intact", async () => {
  const item = await makeAdItem({ status: "approved" });
  const intentId = deriveAutopilotLaunchIntentId(item.item_id);
  const brand = (await db.query("SELECT * FROM brands WHERE brand_id = $1", [brandId])).rows[0];

  const launched = await launchFacebookCampaign({
    userId,
    brand,
    goal: "leads",
    budget: 5,
    preassignedCampaignId: intentId,
    creativeOverride: { headline: "H", primaryText: "P" },
  });
  assert.equal(launched.campaignId, intentId);

  // A forced second fire of the SAME intent must dedup (the backstop), throw
  // an honest 409, and record NOTHING under the winner's id.
  await assert.rejects(
    () =>
      launchFacebookCampaign({
        userId,
        brand,
        goal: "leads",
        budget: 5,
        preassignedCampaignId: intentId,
        creativeOverride: { headline: "H", primaryText: "P" },
      }),
    (err) => err.deduplicated === true && err.statusCode === 409
  );
  assert.deepEqual(counts, { campaigns: 1, adsets: 1, adcreatives: 1, ads: 1 });
  const camp = await db.query("SELECT status FROM campaigns WHERE campaign_id = $1", [intentId]);
  assert.equal(camp.rows.length, 1, "one campaigns row — dedup loser recorded nothing");
  assert.equal(camp.rows[0].status, "created_paused");

  // Winner trail (attempt 1) untouched by the duplicate fire.
  const { rows: attempts } = await db.query(
    `SELECT attempt, status, task_id FROM agent_tasks
      WHERE task_type = 'ad_launch' AND source_type = 'campaign' AND source_id = $1
      ORDER BY attempt ASC`,
    [intentId]
  );
  assert.equal(attempts[0].attempt, 1);
  assert.equal(attempts[0].status, "COMPLETED", "winner trail untouched by the duplicate fire");

  // Source-uniqueness / detection backstop NOT weakened: the forced
  // duplicate's dangling attempt (dedup'd before any provider call, so it
  // never progressed) is parked in MANUAL_REVIEW by the existing scan.
  if (attempts.length > 1) {
    assert.equal(attempts[1].status, "EXECUTING", "dedup loser never progressed");
    await db.query("UPDATE agent_tasks SET updated_at = NOW() - INTERVAL '2 hours' WHERE task_id = $1", [
      attempts[1].task_id,
    ]);
    await taskSpine.scanForMissingTasks({ lookbackHours: 1, limit: 50 });
    const { rows } = await db.query("SELECT status FROM agent_tasks WHERE task_id = $1", [attempts[1].task_id]);
    assert.equal(rows[0].status, "MANUAL_REVIEW", "existing backstop reaches MANUAL_REVIEW");
  }
});

// ---------------------------------------------------------------------------
// J14 — consumer safety: approved + no campaigns row never implies a live
// campaign. itemView passthrough must expose campaignId = null.
// ---------------------------------------------------------------------------

test("J14: approved item with no campaigns row exposes campaignId null (never implies a Facebook campaign exists)", async () => {
  const item = await makeNoLinkAdItem();
  const first = await approve(item.item_id); // pre-provider failure
  assert.notEqual(first.statusCode, 200);
  const row = await itemRow(item.item_id);
  assert.equal(row.status, "approved");
  assert.equal(row.campaign_id, null, "no pre-execution campaign_id write, FK semantics preserved");
});

// ---------------------------------------------------------------------------
// J15 — governing re-execution rule verbatim in code and docs.
// ---------------------------------------------------------------------------

test("J15: D-41 governing re-execution rule appears verbatim in adLaunchSpine.js and TASK_SPINE_GUIDE.md", () => {
  const RULE =
    "For an Autopilot launch intent, automatic provider execution is permitted only when durable evidence proves zero provider side effects across every prior attempt AND no campaigns row exists for the derived intent ID. Evidence is CLEAN only when either (a) no prior execution attempt exists, or (b) every prior attempt terminated before any provider call and contains no partial provider IDs; in both cases, no campaigns row may exist for the intent. Any prior `in_progress`, `interrupted`, `succeeded`, provider-accepted/manual-review state, any recorded partial provider ID, or any campaigns row for the intent makes the launch EVIDENCE-DIRTY and MUST NOT trigger provider execution automatically.";
  const code = fs.readFileSync(path.join(__dirname, "..", "utils", "adLaunchSpine.js"), "utf8");
  const docs = fs.readFileSync(path.join(__dirname, "..", "..", "TASK_SPINE_GUIDE.md"), "utf8");
  assert.ok(code.includes(RULE), "verbatim rule missing from utils/adLaunchSpine.js");
  assert.ok(docs.includes(RULE), "verbatim rule missing from TASK_SPINE_GUIDE.md");
});
