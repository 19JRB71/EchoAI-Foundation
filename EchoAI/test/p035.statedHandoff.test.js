/**
 * Prompt 035 Stage 2 — Section C: owner-stated fact handoff.
 *
 * Explicit interview answers (phone, address, hours, email) are written
 * VERBATIM through the Prompt-011 owner-edit path (source=stated) — never
 * paraphrased, never defaulted. AI-derived values NEVER take this path; they
 * go through pending proposals with owner review (the existing machinery).
 * brandKnowledge is stubbed — this file tests the handoff contract.
 *
 * Run with:  node --test test/p035.statedHandoff.test.js
 */

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const knowledge = require("../utils/brandKnowledge");
const { applyStatedFacts, STATED_FACT_MAP } = require("../controllers/setupAgentController");

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";

const originals = {
  getApprovedKnowledge: knowledge.getApprovedKnowledge,
  ownerEditFields: knowledge.ownerEditFields,
};
let approved;
let writes;

beforeEach(() => {
  approved = {};
  writes = [];
  knowledge.getApprovedKnowledge = async () => approved;
  knowledge.ownerEditFields = async (args) => {
    writes.push(args);
  };
});
afterEach(() => {
  knowledge.getApprovedKnowledge = originals.getApprovedKnowledge;
  knowledge.ownerEditFields = originals.ownerEditFields;
});

test("handoff.verbatimOnly.statedPath — explicit answers are written VERBATIM via ownerEditFields", async () => {
  const answers = {
    business_phone: "(555) 010-2030 — call after 9, ask for Joe",
    business_address: "12 Elm St, Suite B, Anytown NY 10001",
    business_hours: "Mon-Fri 8ish to 5, sometimes Saturdays",
    contact_email: "joe@joesplumbing.com",
  };
  const written = await applyStatedFacts(USER, BRAND, answers);
  assert.deepEqual(written.sort(), ["address", "email", "hours", "phone"]);
  assert.equal(writes.length, 1);
  const byKey = Object.fromEntries(writes[0].fields.map((f) => [f.fieldKey, f.value]));
  // VERBATIM — the quirky phrasing survives byte-for-byte, no normalization.
  assert.equal(byKey.phone, answers.business_phone);
  assert.equal(byKey.hours, answers.business_hours);
  assert.equal(writes[0].proposedBy, "setup_interview");
  assert.equal(writes[0].brandId, BRAND);
  assert.equal(writes[0].userId, USER);
});

test("handoff.paraphrase.goesPending — nothing outside the stated map ever takes the stated path", async () => {
  // AI-derived / interpretive answers (descriptions, audience, etc.) must go
  // through the pending-proposal machinery, not the verbatim stated path.
  const answers = {
    business_description: "We are the best plumbers in town",
    target_audience: "homeowners",
    services_offered: "drains, pipes",
  };
  const written = await applyStatedFacts(USER, BRAND, answers);
  assert.deepEqual(written, []);
  assert.equal(writes.length, 0);
  // And the stated map itself covers ONLY the four contact-fact keys.
  assert.deepEqual(
    STATED_FACT_MAP.map((m) => m.fieldKey).sort(),
    ["address", "email", "hours", "phone"],
  );
});

test("refusals are never written as facts", async () => {
  const written = await applyStatedFacts(USER, BRAND, {
    business_phone: "no",
    business_address: "we don't have a storefront",
    business_email: "none",
  });
  assert.deepEqual(written, []);
  assert.equal(writes.length, 0);
});

test("idempotent — a value equal to the current approved value is not re-versioned", async () => {
  approved = { phone: { value: "555-0000" } };
  const written = await applyStatedFacts(USER, BRAND, { business_phone: "555-0000" });
  assert.deepEqual(written, []);
  assert.equal(writes.length, 0);
  // But a CHANGED value writes.
  const written2 = await applyStatedFacts(USER, BRAND, { business_phone: "555-9999" });
  assert.deepEqual(written2, ["phone"]);
});

test("oversize answers are skipped (substrate guard), other fields still write", async () => {
  const written = await applyStatedFacts(USER, BRAND, {
    business_address: "x".repeat(8001),
    business_phone: "555-1212",
  });
  assert.deepEqual(written, ["phone"]);
});

test("write failures surface to the caller — never swallowed silently", async () => {
  knowledge.ownerEditFields = async () => {
    throw new Error("substrate write failed");
  };
  await assert.rejects(
    () => applyStatedFacts(USER, BRAND, { business_phone: "555-1212" }),
    /substrate write failed/,
  );
});
