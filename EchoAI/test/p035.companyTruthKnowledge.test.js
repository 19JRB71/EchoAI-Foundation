/**
 * Prompt 035 Stage 2 — Section C4: Company Truth reads approved owner facts.
 *
 * gatherCompanyData must surface the owner's APPROVED knowledge fields
 * (phone/address/hours/email/…) through the canonical Prompt-011 projection,
 * with the fail-honest probe pattern: a read failure is surfaced as a probe
 * error, never treated as "no data".
 *
 * Run with:  node --test test/p035.companyTruthKnowledge.test.js
 */

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const knowledge = require("../utils/brandKnowledge");
const companyTruth = require("../utils/companyTruth");

const BRAND = {
  brand_id: "22222222-2222-4222-8222-222222222222",
  user_id: "11111111-1111-4111-8111-111111111111",
  brand_name: "Joe's Plumbing",
};

const originals = {
  query: db.query,
  getApprovedKnowledge: knowledge.getApprovedKnowledge,
};

beforeEach(() => {
  // Every OTHER probe's query returns empty — isolation: we only exercise
  // the approved_owner_facts probe.
  db.query = async () => ({ rows: [] });
});
afterEach(() => {
  db.query = originals.query;
  knowledge.getApprovedKnowledge = originals.getApprovedKnowledge;
});

test("approved knowledge fields reach the Company Truth source set", async () => {
  knowledge.getApprovedKnowledge = async (brandId) => {
    assert.equal(brandId, BRAND.brand_id);
    return {
      phone: { value: "(555) 010-2030 — ask for Joe", sourceKind: "stated" },
      hours: { value: "Mon-Fri 8ish to 5", sourceKind: "stated" },
    };
  };
  const data = await companyTruth.gatherCompanyData(BRAND);
  const src = data.sources.find((s) => s.name === "approved_owner_facts");
  assert.ok(src, "approved_owner_facts probe exists");
  assert.equal(src.available, true);
  assert.equal(src.data.phone.value, "(555) 010-2030 — ask for Joe");
  assert.equal(src.data.phone.source, "stated");
  assert.equal(src.data.hours.value, "Mon-Fri 8ish to 5");
});

test("no approved knowledge → honest null (not fabricated empties)", async () => {
  knowledge.getApprovedKnowledge = async () => ({});
  const data = await companyTruth.gatherCompanyData(BRAND);
  const src = data.sources.find((s) => s.name === "approved_owner_facts");
  assert.equal(src.available, true);
  assert.equal(src.data, null);
});

test("a knowledge read failure is surfaced as a probe error — never 'no data'", async () => {
  knowledge.getApprovedKnowledge = async () => {
    throw new Error("substrate unavailable");
  };
  const data = await companyTruth.gatherCompanyData(BRAND);
  const src = data.sources.find((s) => s.name === "approved_owner_facts");
  assert.equal(src.available, false);
  assert.match(src.error, /substrate unavailable/);
});
