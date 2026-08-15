/**
 * Prompt 035 Stage 2 — Section D1: UNATTRIBUTED candidate discovery.
 *
 * Name-only research runs produce entity CANDIDATES ("this might be your
 * website / Facebook page"), never attributed facts. The `_candidates` key is
 * deliberately NOT a Prompt-011 field key, so it can never enter the
 * knowledge substrate through assertFieldKey — attribution structurally
 * requires the owner's confirmation (which turns the URL into a real anchor).
 *
 * Run with:  node --test test/p035.candidateDiscovery.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const sageResearch = require("../utils/sageResearch");
const { FIELD_KEYS } = sageResearch;

const { candidateSuggestions, dedupCandidateSuggestions } = sageResearch;

test("pi.candidates.neverAttributedWithoutIdentity — _candidates is not a knowledge field key", () => {
  assert.equal(FIELD_KEYS.includes("_candidates"), false);
});

test("candidateSuggestions extracts website/facebook candidates from public-web findings", () => {
  const result = {
    found: true,
    findings: [
      { field: "website_url", value: "https://joes-plumbing.com", excerpt: "Joe's Plumbing — Anytown" },
      { field: "facebook", value: "https://facebook.com/joesplumbing" },
      { field: "description", value: "some text", url: "https://www.facebook.com/other-joes" },
      { field: "phone", value: "555-1234", url: "https://directory.example.com/joes" },
    ],
  };
  const cands = candidateSuggestions(result);
  const kinds = cands.map((c) => c.kind).sort();
  assert.ok(kinds.includes("website"));
  assert.ok(kinds.includes("facebook"));
  assert.ok(kinds.includes("source"));
  // Facebook-hosted source urls classify as facebook, not generic source.
  assert.ok(cands.some((c) => c.kind === "facebook" && c.url === "https://www.facebook.com/other-joes"));
  for (const c of cands) {
    assert.match(c.url, /^https?:\/\//i);
    // A candidate carries NO field/value attribution shape — just a lead.
    assert.equal(c.field, undefined);
    assert.equal(c.value, undefined);
  }
});

test("candidateSuggestions returns [] on not-found or malformed results", () => {
  assert.deepEqual(candidateSuggestions(null), []);
  assert.deepEqual(candidateSuggestions({ found: false, findings: [{ field: "website_url", value: "https://x.com" }] }), []);
  assert.deepEqual(candidateSuggestions({ found: true, findings: "nope" }), []);
  // Non-http(s) values can never become candidates.
  assert.deepEqual(
    candidateSuggestions({ found: true, findings: [{ field: "website_url", value: "javascript:alert(1)" }] }),
    [],
  );
});

test("dedupCandidateSuggestions dedups by kind+url (case-insensitive) and caps at 8", () => {
  const many = [];
  for (let i = 0; i < 12; i += 1) many.push({ kind: "source", url: `https://s${i}.com` });
  many.push({ kind: "website", url: "https://JOES.com" });
  many.push({ kind: "website", url: "https://joes.com" });
  const out = dedupCandidateSuggestions(many);
  assert.equal(out.length, 8);
  const keys = out.map((c) => `${c.kind}|${c.url.toLowerCase()}`);
  assert.equal(new Set(keys).size, keys.length);
});
