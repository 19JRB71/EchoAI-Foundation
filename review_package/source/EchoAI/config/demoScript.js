// Fixed Echo demo voice lines for Sales Presentation Mode.
//
// Each line is templated with the current demo business + prospect name so the
// presenter can re-brand the demo per prospect. The presenter toolbar enqueues
// these into the existing Echo voice engine (POST /api/echo-voice/speak).
//
// Steps are tier-aware: each step declares the minimum tier that unlocks the
// feature it showcases, so the Starter demo walks only Starter features, the
// Professional demo adds its Pro features, and Enterprise shows everything.

const TIER_RANK = { starter: 1, pro: 2, enterprise: 3 };
const rankOf = (tier) => TIER_RANK[tier] || 1;

function buildDemoScript({ businessName, prospectName, morningBriefing } = {}) {
  const business = (businessName || "Premier Auto Group").trim();
  const prospect = (prospectName || "").trim();
  const greet = prospect ? `${prospect}, ` : "";

  return {
    briefing:
      morningBriefing ||
      `Good morning${prospect ? " " + prospect : ""}. Here is your daily briefing for ${business}.`,
    team:
      `${greet}meet your AI marketing department — eight specialists working around ` +
      `the clock so you never have to think about marketing again.`,
    hotLeads:
      `Right now Pulse is managing 47 active leads and has already followed up with ` +
      `every single one automatically — no lead ever falls through the cracks.`,
    campaigns:
      `Atlas is running four live Facebook campaigns for ${business}, and Forge has ` +
      `already generated five ad creative packages ready to launch.`,
    adcreative:
      `Forge builds complete ad creative packages for ${business} — headlines, ` +
      `angles, and calls to action across five proven directions, ready to launch.`,
    social:
      `Nova keeps ${business} everywhere your customers are — posting across ` +
      `Instagram, Facebook, and more on a schedule tuned to when your audience is watching.`,
    followups:
      `Pulse never lets a lead go cold — every prospect gets a personalized, ` +
      `multi-step follow-up across email and text until they book or buy.`,
    competitor:
      `Scout analyzed your top competitors in Orlando and found exactly where they're ` +
      `weak — slow response times — so you can win every lead they let slip.`,
    roi:
      `Here's the bottom line: ${business} spent eighteen hundred and fifty dollars ` +
      `and generated a hundred and twenty-seven thousand dollars in pipeline revenue.`,
    close:
      `${greet}this is your entire marketing department, working for you twenty-four ` +
      `seven, for less than the cost of a single hire. Which plan would you like to start with?`,
  };
}

// Toolbar button definitions: label, the section/department to open, the script
// key to speak, an optional department agent id, and `tier` — the minimum tier
// whose demo includes this step. `stepsForTier` filters accordingly.
const DEMO_STEPS = [
  { key: "briefing", label: "Morning Briefing", section: "missioncontrol", speak: "briefing", tier: "starter" },
  { key: "team", label: "Meet Your Team", section: "aiteam", speak: "team", tier: "starter" },
  { key: "hotLeads", label: "Hot Leads", section: "leads", department: "pulse", speak: "hotLeads", tier: "starter" },
  { key: "campaigns", label: "Live Campaigns", section: "campaigns", department: "atlas", speak: "campaigns", tier: "starter" },
  { key: "adcreative", label: "Ad Creative Studio", section: "adstudio", department: "forge", speak: "adcreative", tier: "pro" },
  { key: "social", label: "Social Media", section: "social", department: "nova", speak: "social", tier: "starter" },
  { key: "followups", label: "Follow-Up Sequences", section: "followups", department: "pulse", speak: "followups", tier: "pro" },
  { key: "competitor", label: "Competitor Report", section: "intelligence", department: "scout", speak: "competitor", tier: "enterprise" },
  { key: "roi", label: "ROI Dashboard", section: "roi", speak: "roi", tier: "starter" },
  { key: "close", label: "Close the Deal", section: "missioncontrol", speak: "close", tier: "starter" },
];

// The subset of steps whose feature is unlocked at `tier` (Starter/Pro/Enterprise).
// Order is preserved so the guided demo flows naturally.
function stepsForTier(tier) {
  const max = rankOf(tier);
  return DEMO_STEPS.filter((s) => rankOf(s.tier) <= max);
}

module.exports = { buildDemoScript, DEMO_STEPS, stepsForTier };
