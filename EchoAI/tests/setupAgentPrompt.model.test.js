/**
 * Prompt 023 acceptance fix 2c (H13 plan) — model-conditional prompt content.
 *
 * The business-model signal (kickoff account_type) must lead to MATERIALLY
 * different questioning per model. The system prompt is the deterministic
 * carrier of that adaptation: this test locks the three model-conditional
 * interview branches and their distinct, non-overlapping question targets so
 * a regression that collapses the interview back to one generic script fails
 * loudly.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { SETUP_AGENT_SYSTEM_PROMPT } = require("../prompts/setupAgentPrompt");

const P = String(SETUP_AGENT_SYSTEM_PROMPT);

test("kickoff asks the business-model signal first (account_type)", () => {
  assert.ok(P.includes("FIRST QUESTION"));
  assert.ok(P.includes('"account_type"'), "kickoff must collect account_type");
  for (const m of ["BUSINESS", "POLITICAL CAMPAIGN", "REAL ESTATE"]) {
    assert.ok(P.includes(m), `kickoff must offer the ${m} model`);
  }
});

test("each model has its own conditional interview branch", () => {
  assert.ok(P.includes("IF THEY ARE A REAL ESTATE AGENT OR TEAM, run the real-estate interview instead of the business one."));
  assert.ok(P.includes("IF THEY ARE A POLITICAL CAMPAIGN, run the campaign interview instead of the business one."));
  assert.ok(P.includes("IF THEY ARE A BUSINESS,"));
});

test("model branches target materially different, model-specific questions", () => {
  // Real estate: markets/listings/buyer-seller focus — absent from other branches' collects.
  for (const key of ["markets_served", "client_focus", "price_range", "active_listings", "target_clients", "brokerage"]) {
    assert.ok(P.includes(`"${key}"`), `real-estate branch must collect ${key}`);
  }
  // Political: district/issues/voters/compliance disclosure.
  for (const key of ["office_sought", "district", "key_issues", "voter_demographics", "opponent_name", "paid_for_by"]) {
    assert.ok(P.includes(`"${key}"`), `political branch must collect ${key}`);
  }
  // Business: website/facebook research inputs.
  for (const key of ["business_website", "facebook_page"]) {
    assert.ok(P.includes(`"${key}"`), `business branch must collect ${key}`);
  }
});

test("model branches speak their own domain language, not generic customers", () => {
  assert.ok(P.includes("buyers, sellers, listings, and showings, not products"));
  assert.ok(P.includes("voters and supporters, not customers"));
  // Political ads compliance is a model-driven question, not a knowledge-gap one.
  assert.ok(P.includes('"Paid for by"'));
});
