const { test } = require("node:test");
const assert = require("node:assert");

const {
  extractJson,
  citationsOf,
  signalKey,
  normalizeFeed,
} = require("../prompts/sagePrompt");
const { sageBlock } = require("../utils/sageContext");

test("extractJson pulls the outermost object out of prose/fences", () => {
  const obj = extractJson('Here is the brief:\n```json\n{"a":1,"b":"x"}\n```');
  assert.deepStrictEqual(obj, { a: 1, b: "x" });
});

test("extractJson throws aiInvalid (→502) when no JSON is present", () => {
  try {
    extractJson("no json here");
    assert.fail("should have thrown");
  } catch (err) {
    assert.strictEqual(err.aiInvalid, true);
  }
});

test("citationsOf dedups real cited sources across block shapes", () => {
  const resp = {
    content: [
      {
        type: "text",
        text: "finding",
        citations: [
          { type: "web_search_result_location", url: "https://a.com", title: "A" },
          { type: "web_search_result_location", url: "https://a.com", title: "A dup" },
        ],
      },
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://b.com", title: "B" },
        ],
      },
    ],
  };
  const cites = citationsOf(resp);
  assert.strictEqual(cites.length, 2);
  assert.deepStrictEqual(
    cites.map((c) => c.url).sort(),
    ["https://a.com", "https://b.com"],
  );
});

test("signalKey normalizes to a stable slug", () => {
  assert.strictEqual(signalKey("  New Regulation!! Coming  "), "new-regulation-coming");
  assert.strictEqual(signalKey("Same  Thing"), signalKey("same thing"));
});

test("normalizeFeed drops incomplete items, dedups, and grounds urls", () => {
  const sources = [
    { url: "https://src.com/1", title: "Source One" },
  ];
  const raw = [
    { source_type: "trend", summary: "Trend A", why_it_matters: "matters" },
    { source_type: "trend", summary: "Trend A", why_it_matters: "dup" }, // dedup
    { source_type: "competitor", summary: "no why" }, // dropped (no why_it_matters)
    {
      source_type: "regulation",
      summary: "Reg B",
      why_it_matters: "matters too",
      url: "https://src.com/1",
      urgent: true,
    },
  ];
  const out = normalizeFeed(raw, sources);
  assert.strictEqual(out.length, 2);
  // First item falls back to the first cited source url.
  assert.strictEqual(out[0].url, "https://src.com/1");
  // Matched url keeps the cited source title.
  const reg = out.find((i) => i.summary === "Reg B");
  assert.strictEqual(reg.source_title, "Source One");
  assert.strictEqual(reg.urgent, true);
});

test("normalizeFeed coerces unknown source_type to 'trend'", () => {
  const out = normalizeFeed(
    [{ source_type: "gossip", summary: "X", why_it_matters: "Y" }],
    [],
  );
  assert.strictEqual(out[0].source_type, "trend");
});

test("sageBlock returns empty string for null/empty context", () => {
  assert.strictEqual(sageBlock(null), "");
  assert.strictEqual(sageBlock(""), "");
});

test("sageBlock wraps real context with a header", () => {
  const block = sageBlock("Industry is booming.");
  assert.ok(block.includes("Industry is booming."));
  assert.ok(block.length > "Industry is booming.".length);
});

test("gatherFacebookSignals degrades to unavailable without a token (never throws)", async () => {
  // FACEBOOK_ACCESS_TOKEN is unset in the test env, so the helper must return a
  // graceful { available:false } result rather than throwing or making a call.
  const { gatherFacebookSignals } = require("../utils/sageFacebook");
  const res = await gatherFacebookSignals(
    { industry: "coffee shops", country: "US" },
    [{ name: "Competitor A", facebook_page: "https://facebook.com/competitora" }],
  );
  assert.strictEqual(res.available, false);
  assert.strictEqual(res.summary, "");
  assert.deepStrictEqual(res.sources, []);
});

test("pageRefFromUrl extracts a Graph page ref (slug or id), rejecting non-pages", () => {
  const { pageRefFromUrl } = require("../utils/sageFacebook");
  assert.strictEqual(pageRefFromUrl("https://facebook.com/CoolBrand"), "CoolBrand");
  assert.strictEqual(pageRefFromUrl("https://www.facebook.com/profile.php?id=123456"), "123456");
  assert.strictEqual(pageRefFromUrl("https://facebook.com/groups/somegroup"), null);
  assert.strictEqual(pageRefFromUrl("https://example.com/notfb"), null);
  assert.strictEqual(pageRefFromUrl(""), null);
  assert.strictEqual(pageRefFromUrl(null), null);
});
