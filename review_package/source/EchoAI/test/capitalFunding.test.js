const { test } = require("node:test");
const assert = require("node:assert");

const {
  validateFunding,
  normalizeSource,
  parseIsoDate,
} = require("../prompts/fundingIntelligencePrompt");
const {
  validateOpportunity,
} = require("../prompts/opportunityIntelligencePrompt");
const {
  validateGrantDraft,
} = require("../prompts/grantWriterPrompt");
const { weekDateFor } = require("../controllers/capitalFundingController");

/* -------------------------- funding intelligence -------------------------- */

test("normalizeSource maps free-text sources to the fixed source set", () => {
  assert.strictEqual(normalizeSource("Small Business Administration"), "SBA");
  assert.strictEqual(normalizeSource("USDA Rural Development"), "USDA");
  assert.strictEqual(normalizeSource("State of Florida"), "Florida");
  assert.strictEqual(normalizeSource("Private Foundation grant"), "Foundation");
  assert.strictEqual(normalizeSource("Grants.gov federal"), "Federal");
  assert.strictEqual(normalizeSource("something else"), "Other");
});

test("validateFunding normalizes scores and computes priority = impact * probability", () => {
  const out = validateFunding({
    opportunities: [
      {
        source: "sba",
        name: "SBA Microloan",
        awardAmount: "$5,000–$50,000",
        amountMax: 50000,
        deadlineText: "Rolling",
        eligibility: "Small businesses",
        description: "Working capital",
        recommendation: "apply",
        rationale: "Strong fit for early-stage capital needs.",
        fitScore: 12, // clamped to 10
        impactScore: 8,
        probabilityScore: 7,
        officialUrl: "https://www.sba.gov/funding-programs",
      },
    ],
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source, "SBA");
  assert.strictEqual(out[0].fitScore, 10);
  assert.strictEqual(out[0].priorityScore, 56);
  assert.strictEqual(out[0].recommendation, "apply");
});

test("validateFunding drops entries missing required text and defaults bad recs", () => {
  const out = validateFunding({
    opportunities: [
      { name: "", eligibility: "x", description: "y", rationale: "z" }, // dropped: no name
      {
        source: "Other",
        name: "Community Grant",
        eligibility: "Locals",
        description: "Funds local projects",
        rationale: "Reasonable fit",
        recommendation: "maybe", // invalid -> consider
        amountMax: -5, // invalid -> null
      },
    ],
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].recommendation, "consider");
  assert.strictEqual(out[0].amountMax, null);
});

test("parseIsoDate keeps concrete dates and rejects cadence strings / bad dates", () => {
  assert.strictEqual(parseIsoDate("2026-09-30"), "2026-09-30");
  assert.strictEqual(parseIsoDate("Rolling"), null);
  assert.strictEqual(parseIsoDate("Annual (verify)"), null);
  assert.strictEqual(parseIsoDate("2026-13-40"), null); // invalid month/day
  assert.strictEqual(parseIsoDate("09/30/2026"), null); // wrong format
  assert.strictEqual(parseIsoDate(null), null);
});

test("validateFunding only keeps a structured deadline when it is a real ISO date", () => {
  const out = validateFunding({
    opportunities: [
      {
        source: "Federal",
        name: "Concrete Deadline Grant",
        eligibility: "Anyone",
        description: "Funds things",
        rationale: "Fits",
        deadline: "2026-09-30",
        deadlineText: "Sept 30 2026",
      },
      {
        source: "Federal",
        name: "Rolling Grant",
        eligibility: "Anyone",
        description: "Funds things",
        rationale: "Fits",
        deadline: "Rolling", // cadence -> null
        deadlineText: "Rolling",
      },
    ],
  });
  assert.strictEqual(out[0].deadline, "2026-09-30");
  assert.strictEqual(out[1].deadline, null);
});

test("validateFunding throws aiInvalid when there are no valid opportunities", () => {
  assert.throws(
    () => validateFunding({ opportunities: [{ name: "" }] }),
    (err) => err.aiInvalid === true,
  );
  assert.throws(
    () => validateFunding({ opportunities: [] }),
    (err) => err.aiInvalid === true,
  );
});

/* ------------------------ opportunity intelligence ------------------------ */

test("validateOpportunity sorts opportunities by priority and keeps briefing arrays", () => {
  const out = validateOpportunity({
    summary: "A strong week for expansion.",
    opportunities: [
      {
        title: "Low priority",
        detail: "minor",
        impact: "low",
        probability: "low",
        priorityScore: 20,
      },
      {
        title: "High priority",
        detail: "major",
        impact: "high",
        probability: "high",
        priorityScore: 90,
      },
    ],
    competitorWeaknesses: [
      { competitor: "Acme", weakness: "slow support", howToCapitalize: "faster SLAs" },
    ],
    marketTrends: [{ trend: "AI adoption", detail: "growing", direction: "up" }],
    partnerships: [{ partner: "Local chamber", rationale: "referrals" }],
    trendingTopics: [{ topic: "sustainability", angle: "green ops" }],
  });
  assert.strictEqual(out.opportunities[0].title, "High priority");
  assert.strictEqual(out.competitorWeaknesses.length, 1);
  assert.strictEqual(out.marketTrends[0].direction, "up");
  assert.strictEqual(out.partnerships.length, 1);
  assert.strictEqual(out.trendingTopics.length, 1);
});

test("validateOpportunity throws aiInvalid on empty summary or no opportunities", () => {
  assert.throws(
    () =>
      validateOpportunity({
        summary: "",
        opportunities: [{ title: "x", detail: "y" }],
      }),
    (err) => err.aiInvalid === true,
  );
  assert.throws(
    () => validateOpportunity({ summary: "ok", opportunities: [] }),
    (err) => err.aiInvalid === true,
  );
});

/* ------------------------------ grant writer ------------------------------ */

test("validateGrantDraft keeps only complete sections", () => {
  const out = validateGrantDraft({
    summary: "Application overview",
    sections: [
      { heading: "Executive Summary", content: "We are..." },
      { heading: "", content: "no heading -> dropped" },
      { heading: "Budget", content: "" }, // dropped: no content
    ],
  });
  assert.strictEqual(out.sections.length, 1);
  assert.strictEqual(out.sections[0].heading, "Executive Summary");
  assert.strictEqual(out.summary, "Application overview");
});

test("validateGrantDraft throws aiInvalid when no valid sections remain", () => {
  assert.throws(
    () => validateGrantDraft({ summary: "x", sections: [{ heading: "", content: "" }] }),
    (err) => err.aiInvalid === true,
  );
  assert.throws(
    () => validateGrantDraft({ summary: "x", sections: [] }),
    (err) => err.aiInvalid === true,
  );
});

/* ------------------------------- week date -------------------------------- */

test("weekDateFor returns the Monday (UTC) of the week", () => {
  // 2026-07-05 is a Sunday -> Monday of that week is 2026-06-29.
  assert.strictEqual(weekDateFor(new Date("2026-07-05T12:00:00Z")), "2026-06-29");
  // 2026-06-29 is a Monday -> itself.
  assert.strictEqual(weekDateFor(new Date("2026-06-29T00:00:00Z")), "2026-06-29");
});
