// Pure text-composer tests for the Echo "navigate first, ask before reading"
// section briefs. The composers are deterministic (no AI) so readouts work even
// when the AI provider is down and can never invent numbers.

const test = require("node:test");
const assert = require("node:assert");

const {
  leadsOfferText,
  campaignsOfferText,
  campaignsBriefText,
  sageOfferText,
  sageBriefText,
} = require("../controllers/echoSectionBriefController");

test("leadsOfferText includes real counts and hot leads", () => {
  const t = leadsOfferText({ total: 12, hot: 3 });
  assert.match(t, /12 leads/);
  assert.match(t, /3 hot leads/);
  assert.match(t, /\?$/); // always a question — Echo asks before reading
});

test("leadsOfferText handles singular and zero honestly", () => {
  assert.match(leadsOfferText({ total: 1, hot: 1 }), /1 lead\b.*1 hot lead\b/);
  const none = leadsOfferText({ total: 0, hot: 0 });
  assert.match(none, /don't have any leads yet/);
  assert.match(none, /\?$/);
  // No hot leads → no hot-lead mention at all (never "0 hot leads").
  assert.doesNotMatch(leadsOfferText({ total: 5, hot: 0 }), /hot/);
});

test("campaignsOfferText counts campaigns and stays a question", () => {
  assert.match(campaignsOfferText(2), /2 campaigns/);
  assert.match(campaignsOfferText(2), /\?$/);
  assert.match(campaignsOfferText(0), /don't have any campaigns yet/);
});

test("campaignsBriefText reads real campaign figures only", () => {
  const t = campaignsBriefText([
    { campaign_name: "Spring Promo", budget: "500.00", cost_per_lead: "12.50", conversion_rate: "0.0800" },
    { campaign_name: "Brand Push", budget: null, cost_per_lead: null, conversion_rate: null },
  ]);
  assert.match(t, /Spring Promo/);
  assert.match(t, /\$500/);
  assert.match(t, /\$12\.50 per lead/);
  assert.match(t, /8 percent/);
  // Missing figures are simply omitted, never invented.
  assert.match(t, /Brand Push/);
  assert.doesNotMatch(t, /Brand Push, budget/);
});

test("sage offer and brief are honest when no report exists", () => {
  assert.match(sageOfferText(null), /hasn't finished a report yet/);
  assert.match(sageOfferText(null), /\?$/);
  assert.match(sageBriefText(null), /hasn't finished an intelligence report yet/);
});

test("sageBriefText reads the summary and top insights", () => {
  const t = sageBriefText({
    summary: "Your industry is shifting to video-first marketing.",
    marketing_insights: [
      { insight: "Short-form video outperforms static ads" },
      { insight: "Local SEO is underused by competitors" },
    ],
  });
  assert.match(t, /video-first marketing/);
  assert.match(t, /Short-form video outperforms static ads/);
  assert.match(t, /Local SEO is underused/);
});

test("sageBriefText tolerates JSONB-as-string insights", () => {
  const t = sageBriefText({
    summary: "S.",
    marketing_insights: JSON.stringify([{ insight: "Parsed fine" }]),
  });
  assert.match(t, /Parsed fine/);
});
