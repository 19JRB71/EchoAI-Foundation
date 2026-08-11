// created_paused narration regressions (Prompt 025, Section C — D-39).
// Narration/reporting only: these tests read the SOURCE of the three swap
// sites to pin the honest wording and prove the state machine is untouched.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("echoBriefing no longer narrates created_paused campaigns as 'running'", () => {
  const src = read("utils/echoBriefing.js");
  // The old sentence is gone…
  assert.ok(!src.includes('} is" : "s are"} running.`'), "old 'N campaigns are running' sentence must be gone");
  // …and the honest chokepoint is used.
  assert.ok(src.includes("campaignCountSentence"), "briefing must narrate via honestStatus.campaignCountSentence");
  assert.ok(src.includes("campaignCountsAsRunning"), "risk line must bucket via honestStatus");
  assert.ok(src.includes("created, paused — not spending"));
});

test("agentsController separates live from created_paused everywhere it counts", () => {
  const src = read("controllers/agentsController.js");
  // No remaining merged count treating created_paused as active/live.
  assert.ok(
    !src.includes("status IN ('created_paused', 'live')"),
    "no query may merge created_paused into an active/live count",
  );
  assert.ok(src.includes("status = 'live'"));
  assert.ok(src.includes("status = 'created_paused'"));
  assert.ok(src.includes("created, paused — not spending"));
});

test("Mission Control greeting counts only live campaigns as live", () => {
  const src = read("controllers/agentsController.js");
  const greeting = src.split("greetingBare(tod.part)")[1] || "";
  assert.ok(greeting.includes("liveCampaigns"), "greeting uses the live-only count");
  assert.ok(!greeting.slice(0, 400).includes("activeCampaigns"), "greeting must not use the merged legacy count");
});

test("section brief states each campaign's honest status", () => {
  const src = read("controllers/echoSectionBriefController.js");
  assert.ok(src.includes("describeCampaignState"), "per-campaign honest state fragment required");
  assert.ok(src.includes("campaign_name, status"), "brief query must select status");
});

test("campaign state machine is untouched (no campaigns.status writes added)", () => {
  // The three narration files must not write campaigns.status.
  for (const rel of [
    "utils/echoBriefing.js",
    "controllers/agentsController.js",
    "controllers/echoSectionBriefController.js",
    "utils/honestStatus.js",
  ]) {
    const src = read(rel);
    assert.ok(
      !/UPDATE\s+campaigns\s+SET\s+status/i.test(src),
      `${rel} must not mutate campaigns.status (narration-only change)`,
    );
  }
});

test("Sage and Vision statuses are no longer hard-coded active", () => {
  const src = read("controllers/agentsController.js");
  const sage = src.split("sage: {")[1].split("},")[0];
  const vision = src.split("vision: {")[1].split("},")[0];
  assert.ok(!/status:\s*"active",/.test(sage), "sage status must be derived");
  assert.ok(!/status:\s*"active",/.test(vision), "vision status must be derived");
});

test("Nova's published count comes from spine truth with sourceClass labeling", () => {
  const src = read("controllers/agentsController.js");
  assert.ok(src.includes("task_type = 'social_publish'"));
  assert.ok(src.includes("'EXTERNALLY_VERIFIED','REPORTED','COMPLETED'"));
  assert.ok(src.includes('sourceClass: "spine"'));
  assert.ok(src.includes('sourceClass: "feature"'));
});
