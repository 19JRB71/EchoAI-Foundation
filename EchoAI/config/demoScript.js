// Fixed Echo demo voice lines for Sales Presentation Mode.
//
// Each line is templated with the current demo business + prospect name so the
// presenter can re-brand the demo per prospect. The presenter toolbar enqueues
// these into the existing Echo voice engine (POST /api/echo-voice/speak).

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
    social:
      `Nova keeps ${business} everywhere your customers are — posting across ` +
      `Instagram, Facebook, and more on a schedule tuned to when your audience is watching.`,
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
// key to speak, and (optionally) a department agent id to open a Department View.
const DEMO_STEPS = [
  { key: "briefing", label: "Morning Briefing", section: "missioncontrol", speak: "briefing" },
  { key: "team", label: "Meet Your Team", section: "aiteam", speak: "team" },
  { key: "hotLeads", label: "Hot Leads", section: "leads", department: "pulse", speak: "hotLeads" },
  { key: "campaigns", label: "Live Campaigns", section: "campaigns", department: "atlas", speak: "campaigns" },
  { key: "social", label: "Social Media", section: "social", department: "nova", speak: "social" },
  { key: "competitor", label: "Competitor Report", section: "intelligence", department: "scout", speak: "competitor" },
  { key: "roi", label: "ROI Dashboard", section: "roi", speak: "roi" },
  { key: "close", label: "Close the Deal", section: "missioncontrol", speak: "close" },
];

module.exports = { buildDemoScript, DEMO_STEPS };
