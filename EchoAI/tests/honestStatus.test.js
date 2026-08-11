// honestStatus unit tests (Prompt 025, Sections B/C/G — pure logic; DB-backed
// paths are covered by the integration suites).

const test = require("node:test");
const assert = require("node:assert");

const hs = require("../utils/honestStatus");
const { OUTCOMES } = hs;

// ---- Closed vocabulary ------------------------------------------------------

test("outcome vocabulary is closed and exact", () => {
  assert.deepStrictEqual(
    [...hs.OUTCOME_VALUES].sort(),
    [
      "in_progress_or_prepared",
      "known_failure",
      "manual_review_uncertain",
      "temporarily_unverifiable",
      "verified_success",
    ],
  );
});

test("every spine status maps into the closed vocabulary", () => {
  const SPINE = [
    "DRAFTED", "REVIEWED", "APPROVED", "QUEUED", "EXECUTING",
    "PROVIDER_ACCEPTED", "EXTERNALLY_VERIFIED", "REPORTED", "COMPLETED",
    "RETRY_SCHEDULED", "AUTH_REQUIRED", "PERMISSION_DENIED", "RATE_LIMITED",
    "VALIDATION_FAILED", "EXTERNAL_FAILURE", "MANUAL_REVIEW", "CANCELLED",
  ];
  for (const s of SPINE) {
    assert.ok(hs.OUTCOME_VALUES.includes(hs.SPINE_OUTCOME[s]), `unmapped spine status ${s}`);
  }
});

// ---- Evidence precedence: the 7 cases --------------------------------------

test("case 1: feature active + spine MANUAL_REVIEW → manual_review_uncertain", () => {
  const r = hs.resolve({
    task: { task_id: "t", status: "MANUAL_REVIEW" },
    feature: { status: "active" },
  });
  assert.strictEqual(r.outcome, OUTCOMES.MANUAL_REVIEW_UNCERTAIN);
});

test("case 2: provider accepted without verified read-back → in_progress_or_prepared", () => {
  const r = hs.resolve({ task: { task_id: "t", status: "PROVIDER_ACCEPTED" } });
  assert.strictEqual(r.outcome, OUTCOMES.IN_PROGRESS_OR_PREPARED);
});

test("case 3: feature row alone can never claim verified success", () => {
  const r = hs.resolve({ feature: { status: "published" } });
  assert.strictEqual(r.outcome, OUTCOMES.IN_PROGRESS_OR_PREPARED);
  assert.strictEqual(r.recordedOnly, true);
});

test("case 3b: success-shaped spine status WITHOUT proof lineage is capped", () => {
  const r = hs.resolve({ task: { task_id: "t", status: "COMPLETED", proof_id: null } });
  assert.strictEqual(r.outcome, OUTCOMES.IN_PROGRESS_OR_PREPARED);
  assert.strictEqual(r.basis, "spine_success_without_proof");
});

test("case 5: verified proof beats a stale feature/spine pending state", () => {
  const r = hs.resolve({
    task: { task_id: "t", status: "EXECUTING" },
    proof: { proof_id: "p", external_id: "x_1", verified_at: "2026-08-11T00:00:00Z" },
    feature: { status: "pending" },
  });
  assert.strictEqual(r.outcome, OUTCOMES.VERIFIED_SUCCESS);
  assert.strictEqual(r.basis, "external_proof");
  assert.ok(r.verifiedAt);
});

test("failure statuses map to known_failure and carry last_error", () => {
  const r = hs.resolve({ task: { task_id: "t", status: "EXTERNAL_FAILURE", last_error: "provider 500" } });
  assert.strictEqual(r.outcome, OUTCOMES.KNOWN_FAILURE);
  assert.strictEqual(r.lastError, "provider 500");
});

test("unknown is not negative: read failure → temporarily_unverifiable, never failure", () => {
  const r = hs.resolve({ readFailed: true });
  assert.strictEqual(r.outcome, OUTCOMES.TEMPORARILY_UNVERIFIABLE);
});

test("no evidence at all → temporarily_unverifiable (absence of proof ≠ failure)", () => {
  const r = hs.resolve({});
  assert.strictEqual(r.outcome, OUTCOMES.TEMPORARILY_UNVERIFIABLE);
  assert.notStrictEqual(r.outcome, OUTCOMES.KNOWN_FAILURE);
});

test("unclassifiable spine status refuses to guess", () => {
  const r = hs.resolve({ task: { task_id: "t", status: "SOMETHING_NEW" } });
  assert.strictEqual(r.outcome, OUTCOMES.MANUAL_REVIEW_UNCERTAIN);
});

// ---- Campaign narration (D-39 / Section C) ----------------------------------

test("created_paused narrates as created, paused — not spending; never running", () => {
  const s = hs.describeCampaignState({ status: "created_paused" });
  assert.strictEqual(s.text, "created, paused — not spending");
  assert.strictEqual(s.running, false);
  assert.strictEqual(hs.campaignCountsAsRunning("created_paused"), false);
});

test("live without recorded verification is recorded-only, not bare 'running'", () => {
  const s = hs.describeCampaignState({ status: "live" });
  assert.ok(s.recordedOnly);
  assert.ok(s.text.includes("per our records"));
});

test("live with recorded verification narrates as-of timestamp (no TTL cutoff)", () => {
  const old = "2026-01-01T00:00:00.000Z"; // months old — still narrated honestly
  const s = hs.describeCampaignState({ status: "live", status_verified_at: old });
  assert.ok(s.text.includes("as of"));
  assert.ok(s.text.includes("2026-01-01"));
});

test("campaign buckets never merge created_paused into running", () => {
  const rows = [
    { status: "live" },
    { status: "created_paused" },
    { status: "created_paused" },
    { status: "completed" },
  ];
  const b = hs.campaignBuckets(rows);
  assert.strictEqual(b.running.length, 1);
  assert.strictEqual(b.createdPaused.length, 2);
  assert.strictEqual(b.other.length, 1);
});

test("count sentence separates live from created_paused and never says 'running' for paused", () => {
  const sentence = hs.campaignCountSentence([
    { status: "live" },
    { status: "created_paused" },
  ]);
  assert.ok(sentence.includes("1 campaign is live"));
  assert.ok(sentence.includes("1 campaign is created, paused — not spending"));
  assert.ok(!/created, paused[^;]*running/.test(sentence));
});

test("count sentence with only created_paused campaigns claims nothing live", () => {
  const sentence = hs.campaignCountSentence([{ status: "created_paused" }]);
  assert.ok(!sentence.includes("live"));
  assert.ok(sentence.includes("not spending"));
});

// ---- Attribution honesty (B5) -----------------------------------------------

test("attribution requires recorded actor lineage — no invented agent credit", () => {
  assert.strictEqual(hs.attributionFor({ meta: {} }), null);
  assert.strictEqual(hs.attributionFor(null), null);
  assert.strictEqual(hs.attributionFor({ meta: { actor: "scheduler" } }), null);
  assert.strictEqual(hs.attributionFor({ meta: { actor: "nova" } }), "nova");
});

// ---- Phrase classes -----------------------------------------------------------

test("standard phrasings exist for every outcome plus recorded-only", () => {
  for (const o of hs.OUTCOME_VALUES) {
    assert.strictEqual(typeof hs.PHRASES[o], "function", `missing phrase for ${o}`);
  }
  assert.ok(hs.PHRASES.RECORDED_ONLY("the post").includes("not externally verified"));
  assert.ok(hs.PHRASES[OUTCOMES.TEMPORARILY_UNVERIFIABLE]("that").startsWith("I can't verify"));
});
