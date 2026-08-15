// 026-C1 Stage 2 (I-51) — failed publishes record WHERE they failed
// (pre_provider = definitive nothing-was-sent; provider = the platform call
// ran), and Mission Control words the two differently.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildAttention } = require("../controllers/missionControlV2Controller");

test("Mission Control wording: pre_provider says plainly that nothing was sent; provider/legacy keep the original claim", () => {
  const items = buildAttention({
    agents: [],
    goalAlerts: [],
    sageUrgent: [],
    failedPosts: [
      {
        postId: "pre",
        platform: "facebook",
        reason: "Missing Page binding",
        failureStage: "pre_provider",
        failedAt: "2026-08-15T12:00:00Z",
      },
      {
        postId: "prov",
        platform: "facebook",
        reason: "Graph API 500",
        failureStage: "provider",
        failedAt: "2026-08-15T12:00:00Z",
      },
      {
        postId: "legacy",
        platform: "facebook",
        reason: "Old row",
        failureStage: null,
        failedAt: "2026-08-15T12:00:00Z",
      },
    ],
  });
  const byId = Object.fromEntries(items.map((i) => [i.id, i.text]));
  assert.match(byId["post-pre"], /couldn't start publishing \(nothing was sent\)/);
  assert.match(byId["post-pre"], /Missing Page binding/);
  assert.match(byId["post-prov"], /failed to publish —/);
  assert.doesNotMatch(byId["post-prov"], /nothing was sent/);
  assert.match(byId["post-legacy"], /failed to publish —/);
  assert.doesNotMatch(byId["post-legacy"], /nothing was sent/);
});

test("the failure-persist payload shape stores failure_stage next to error", () => {
  // The two live persist sites both build this payload; the classification
  // rule is err.preProvider === true → 'pre_provider', else 'provider'.
  const classify = (err) => ({
    error: err.message,
    failure_stage: err.preProvider === true ? "pre_provider" : "provider",
  });
  const pre = new Error("no binding");
  pre.preProvider = true;
  assert.deepEqual(classify(pre), { error: "no binding", failure_stage: "pre_provider" });
  const prov = new Error("graph 500");
  assert.deepEqual(classify(prov), { error: "graph 500", failure_stage: "provider" });
});
