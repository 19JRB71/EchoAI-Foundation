// Task: Jobber integration (field-service CRM). The live GraphQL calls need a
// real Jobber OAuth grant, so these tests pin everything that must hold
// without touching Jobber's API:
//  - the pure helpers that map Jobber payloads to CRM rows and back
//    (phone normalization, primary email/phone pick, lead → ClientCreateInput),
//  - getValidAccessToken fails with a tagged notConnected error when the user
//    has no Jobber grant (the route maps this to a 400, never a 500),
//  - createJobberClientForLead is idempotent: an already-linked lead returns
//    immediately without any network call,
//  - autoCreateClientForLead (the convert hook) is a silent no-op when the
//    owner has no Jobber connection — a conversion must never fail on Jobber.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePhone,
  primaryOf,
  clientInputFromLead,
  getValidAccessToken,
  createJobberClientForLead,
  autoCreateClientForLead,
} = require("../controllers/jobberController");
const { db, createTestUser, deleteUser } = require("./helpers");

let userId;
let brandId;
let leadId;

before(async () => {
  userId = await createTestUser();
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id`,
    [userId, "Jobber Test Brand"],
  );
  brandId = rows[0].brand_id;
  const lead = await db.query(
    `INSERT INTO leads (brand_id, lead_name, email, phone)
     VALUES ($1, 'Jane Prospect', 'jane@example.com', '555-010-2233')
     RETURNING lead_id`,
    [brandId],
  );
  leadId = lead.rows[0].lead_id;
});

after(async () => {
  await deleteUser(userId);
});

test("normalizePhone keeps the last 10 digits and rejects junk", () => {
  assert.equal(normalizePhone("+1 (555) 010-2233"), "5550102233");
  assert.equal(normalizePhone("555.010.2233"), "5550102233");
  assert.equal(normalizePhone("123"), null);
  assert.equal(normalizePhone(null), null);
});

test("primaryOf prefers the primary entry, falls back to the first", () => {
  const emails = [
    { address: "second@x.com", primary: false },
    { address: "main@x.com", primary: true },
  ];
  assert.equal(primaryOf(emails, "address"), "main@x.com");
  assert.equal(primaryOf([{ address: "only@x.com" }], "address"), "only@x.com");
  assert.equal(primaryOf([], "address"), null);
  assert.equal(primaryOf(null, "address"), null);
});

test("clientInputFromLead maps name/email/phone into ClientCreateInput", () => {
  const input = clientInputFromLead({
    lead_name: "Jane Q Prospect",
    email: "jane@example.com",
    phone: "555-010-2233",
  });
  assert.equal(input.firstName, "Jane");
  assert.equal(input.lastName, "Q Prospect");
  assert.equal(input.emails[0].address, "jane@example.com");
  assert.equal(input.emails[0].primary, true);
  assert.equal(input.phones[0].number, "555-010-2233");
});

test("clientInputFromLead tolerates a missing name and omits empty contact arrays", () => {
  const input = clientInputFromLead({ lead_name: null, email: null, phone: null });
  assert.equal(input.firstName, "Unknown");
  assert.equal(input.lastName, undefined);
  assert.equal(input.emails, undefined);
  assert.equal(input.phones, undefined);
});

test("getValidAccessToken throws a tagged notConnected error without a grant", async () => {
  await assert.rejects(
    () => getValidAccessToken(userId),
    (err) => err.notConnected === true,
  );
});

test("createJobberClientForLead is a no-op for an already-linked lead", async () => {
  const result = await createJobberClientForLead(userId, {
    lead_id: leadId,
    jobber_client_id: "already-linked-id",
  });
  assert.deepEqual(result, {
    jobberClientId: "already-linked-id",
    alreadyLinked: true,
  });
});

test("createJobberClientForLead re-reads the link under the lock (race-safe short-circuit)", async () => {
  // Simulate a concurrent send having won: the DB row is already linked but
  // the in-memory lead object is stale (no jobber_client_id). The under-lock
  // re-read must return the existing link WITHOUT any Jobber network call
  // (the user has no grant, so a network attempt would throw notConnected).
  const staleLead = await db.query(
    `INSERT INTO leads (brand_id, lead_name, email, jobber_client_id)
     VALUES ($1, 'Race Lead', 'race@example.com', 'won-by-other-request')
     RETURNING lead_id`,
    [brandId],
  );
  const result = await createJobberClientForLead(userId, {
    lead_id: staleLead.rows[0].lead_id,
    jobber_client_id: null,
    lead_name: "Race Lead",
    email: "race@example.com",
  });
  assert.equal(result.jobberClientId, "won-by-other-request");
  assert.equal(result.alreadyLinked, true);
});

test("operational Jobber routes are lockout-gated; connection management is not", () => {
  const router = require("../routes/jobberRoutes");
  const gated = [];
  const ungated = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    const names = layer.route.stack.map((s) => s.name);
    (names.includes("lockoutCheck") ? gated : ungated).push(path);
  }
  for (const p of ["/clients/import", "/schedule", "/leads/:leadId/send"]) {
    assert.ok(gated.includes(p), `${p} must be lockout-gated`);
  }
  for (const p of ["/oauth/initiate", "/status", "/disconnect", "/oauth/callback"]) {
    assert.ok(ungated.includes(p), `${p} must stay reachable for recovery`);
  }
});

test("autoCreateClientForLead never throws when Jobber is not connected", async () => {
  await autoCreateClientForLead(leadId);
  const { rows } = await db.query(
    `SELECT jobber_client_id FROM leads WHERE lead_id = $1`,
    [leadId],
  );
  assert.equal(rows[0].jobber_client_id, null);
});
