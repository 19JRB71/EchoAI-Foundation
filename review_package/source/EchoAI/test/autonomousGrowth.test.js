const { test } = require("node:test");
const assert = require("node:assert");

const {
  classifyCampaigns,
  isFatigued,
  buildSummaryText,
} = require("../controllers/autonomousGrowthController");

test("classifyCampaigns splits winners and losers by cost-per-lead median", () => {
  const campaigns = [
    { campaign_id: "a", cost_per_lead: 5 },
    { campaign_id: "b", cost_per_lead: 10 },
    { campaign_id: "c", cost_per_lead: 30 }, // >= median(10) * 1.5 => loser
  ];
  const { winners, losers, median } = classifyCampaigns(campaigns);
  assert.strictEqual(median, 10);
  assert.ok(winners.some((c) => c.campaign_id === "a"));
  assert.ok(losers.some((c) => c.campaign_id === "c"));
  // top winner is the cheapest
  assert.strictEqual(winners[0].campaign_id, "a");
});

test("classifyCampaigns ignores campaigns without cost data", () => {
  const { winners, losers, median } = classifyCampaigns([
    { campaign_id: "a", cost_per_lead: null },
    { campaign_id: "b", cost_per_lead: 0 },
  ]);
  assert.strictEqual(median, null);
  assert.deepStrictEqual(winners, []);
  assert.deepStrictEqual(losers, []);
});

test("classifyCampaigns produces no losers with a single campaign", () => {
  const { losers } = classifyCampaigns([{ campaign_id: "a", cost_per_lead: 100 }]);
  assert.deepStrictEqual(losers, []);
});

test("isFatigued flags campaigns with no queued variations", () => {
  assert.strictEqual(isFatigued({ conversion_rate: 0.2, ad_creative_variations: null }), true);
  assert.strictEqual(isFatigued({ conversion_rate: 0.2, ad_creative_variations: [] }), true);
});

test("isFatigued flags low-converting campaigns even with variations", () => {
  assert.strictEqual(
    isFatigued({ conversion_rate: 0.005, ad_creative_variations: [{ headline: "x" }] }),
    true,
  );
});

test("isFatigued leaves healthy, stocked campaigns alone", () => {
  assert.strictEqual(
    isFatigued({ conversion_rate: 0.08, ad_creative_variations: [{ headline: "x" }] }),
    false,
  );
});

test("buildSummaryText lists auto actions and proposals separately", () => {
  const text = buildSummaryText("James", [
    { status: "auto_executed", title: "Adjusted budget on Alpha" },
    { status: "proposed", title: "Approval needed: raise budget on Beta" },
  ]);
  assert.match(text, /James/);
  assert.match(text, /on my own/);
  assert.match(text, /Adjusted budget on Alpha/);
  assert.match(text, /waiting for your OK/);
  assert.match(text, /raise budget on Beta/);
});

test("buildSummaryText handles a quiet day gracefully", () => {
  const text = buildSummaryText("there", []);
  assert.match(text, /running smoothly/);
});
