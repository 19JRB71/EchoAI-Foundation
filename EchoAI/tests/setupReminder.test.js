/**
 * Regression tests for Echo's unfinished-setup reminder in the morning
 * briefing. The reminder is one gentle sentence, driven by real account state
 * (utils/setupStatus.topIncompleteSetup), and must be absent when everything
 * is set up (setupReminder null).
 */
const test = require("node:test");
const assert = require("node:assert");

const { templateMorning } = require("../utils/echoBriefing");

function baseData(extra = {}) {
  return {
    brands: [{ brand_id: "b1", brand_name: "Blacor Homes" }],
    newLeads: [{ name: "A" }],
    hotLeads: 0,
    todaysAppointments: [],
    followUpsCompleted: 0,
    campaigns: [],
    sentinelFixes: [],
    pendingApprovals: 0,
    competitorNote: null,
    sageNote: null,
    facebookConnected: true,
    goals: null,
    newSupporters: 0,
    upcomingCampaignEvents: [],
    newPropertyLeads: 0,
    newListings: 0,
    upcomingOpenHouses: [],
    remindersToday: [],
    openTasks: [],
    emailCounts: null,
    setupReminder: null,
    ...extra,
  };
}

test("no setup reminder line when everything is set up", () => {
  const text = templateMorning("James", baseData());
  assert.ok(!text.includes("setup isn't finished"));
});

test("mentions the unfinished setup and its next step", () => {
  const text = templateMorning(
    "James",
    baseData({
      setupReminder: {
        key: "chatbot",
        label: "Website chatbot",
        section: "chatbot",
        brandName: "Blacor Homes",
        nextStep: "Set up your chatbot",
      },
    })
  );
  assert.ok(text.includes("website chatbot setup isn't finished"));
  assert.ok(text.includes("set up your chatbot"));
});

test("names the brand when the owner has more than one", () => {
  const text = templateMorning(
    "James",
    baseData({
      brands: [
        { brand_id: "b1", brand_name: "Blacor Homes" },
        { brand_id: "b2", brand_name: "Second Venture" },
      ],
      setupReminder: {
        key: "social",
        label: "Social media accounts",
        section: "social",
        brandName: "Second Venture",
        nextStep: "Connect at least one social account",
      },
    })
  );
  assert.ok(text.includes("social media accounts setup for Second Venture"));
});

test("omits the brand name when the owner has just one brand", () => {
  const text = templateMorning(
    "James",
    baseData({
      setupReminder: {
        key: "social",
        label: "Social media accounts",
        section: "social",
        brandName: "Blacor Homes",
        nextStep: "Schedule your first post",
      },
    })
  );
  assert.ok(text.includes("social media accounts setup isn't finished"));
  assert.ok(!text.includes("for Blacor Homes"));
});

test("handles a reminder without a next step", () => {
  const text = templateMorning(
    "James",
    baseData({
      setupReminder: { key: "google", label: "Google connection", section: "googleseo" },
    })
  );
  assert.ok(text.includes("google connection setup isn't finished"));
});
