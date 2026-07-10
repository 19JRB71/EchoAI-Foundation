// Demo Mode — AI marketing suggestions for Sales Presentation Mode.
//
// Five pre-crafted, realistic suggestions Echo delivers live during a demo so
// every prospect sees exactly what Echo would proactively do for their business.
// Each is wired to a demo step (section) via `step` and to the AI agent that
// "discovered" it via `agent`. The presenter can Accept (Echo executes it with a
// confirmation) or Dismiss (Echo acknowledges and moves on).
//
// buildSuggestions() templates the prospect + business name into the spoken
// lines. The Admin Demo tab can also replace these with an AI-adapted set built
// from a free-form scenario (see demoController.adaptSuggestions) so the same
// demo can reference, e.g., a restaurant instead of a car dealership.

// Agent id -> avatar color (kept in sync with client/src/lib/departments.js so
// the companion card avatar matches the agent that surfaced the suggestion).
const AGENT_COLORS = {
  echo: "#14b8a6",
  scout: "#0EA5E9",
  atlas: "#6366F1",
  nova: "#EC4899",
  pulse: "#F97316",
};

// The five built-in suggestions. `text`, `acceptLine`, and `dismissLine` are
// functions of { prospect, business } so names can be personalized per prospect.
const SUGGESTION_DEFS = [
  {
    id: "budget-reallocation",
    step: "campaigns",
    agent: "atlas",
    tier: "starter",
    title: "Budget reallocation opportunity",
    action: "Shifting 30% of Tuesday's budget to Friday…",
    text: ({ prospect }) =>
      `${prospect ? prospect + ", " : ""}I've been watching your campaign performance and noticed your Tuesday ads are costing forty percent more per lead than your Friday ads. If we shift thirty percent of the Tuesday budget to Friday, I project twelve more leads this month at the same total spend. Want me to make that adjustment right now?`,
    acceptLine: () =>
      `Executing that change now — moving thirty percent of Tuesday's budget over to Friday. Done. I'll track the new cost-per-lead and report back.`,
    dismissLine: () =>
      `No problem — I'll leave the budget where it is and keep an eye on the Tuesday-versus-Friday gap for you.`,
  },
  {
    id: "competitor-threat",
    step: "competitor",
    agent: "scout",
    tier: "enterprise",
    title: "Competitor threat response",
    action: "Drafting the counter-campaign…",
    text: ({ business }) =>
      `Scout just flagged something important. Two competing ${business.match(/auto|car|dealer/i) ? "dealerships" : "businesses"} launched zero-down financing promotions this weekend. I've already drafted a counter-campaign highlighting ${business}'s price-match guarantee and same-day financing approval. Want to review it before I launch?`,
    acceptLine: () =>
      `Executing now — launching the counter-campaign so you stay a step ahead. I'll watch how their promo performs and adjust ours to keep winning the comparison shoppers.`,
    dismissLine: () =>
      `Understood — I'll hold the counter-campaign and keep monitoring those competitors so we can respond the moment it matters.`,
  },
  {
    id: "social-opportunity",
    step: "social",
    agent: "nova",
    tier: "starter",
    title: "Social media opportunity",
    action: "Rebalancing your social schedule…",
    text: () =>
      `Nova noticed your Instagram posts are getting three times more engagement than Facebook right now. I recommend increasing Instagram posting from three to five times per week and shifting some of the Facebook budget to Instagram boosting. This could increase your total reach by forty percent at no extra cost. Should I make those changes?`,
    acceptLine: () =>
      `Executing that now — bumping Instagram to five posts a week and reallocating the boost budget. You should see the reach climb over the next few days.`,
    dismissLine: () =>
      `Got it — I'll keep the current schedule and let you know if the engagement gap keeps widening.`,
  },
  {
    id: "lead-followup",
    step: "hotLeads",
    agent: "pulse",
    tier: "starter",
    title: "Lead follow-up insight",
    action: "Sending personalized follow-ups…",
    text: () =>
      `Pulse flagged something interesting. You have fourteen warm leads who visited your website more than three times this week but haven't been contacted yet. These are high-intent prospects. I've drafted personalized follow-up messages for each one. Want me to send them now?`,
    acceptLine: () =>
      `Sending them now — all fourteen personalized follow-ups are going out. I'll route any replies straight to your Hot Leads and alert you the moment one responds.`,
    dismissLine: () =>
      `No problem — I'll keep those fourteen leads queued and nudge you again before they go cold.`,
  },
  {
    id: "seasonal-opportunity",
    step: "roi",
    agent: "scout",
    tier: "starter",
    title: "Seasonal opportunity",
    action: "Preparing the end-of-month burst campaign…",
    text: () =>
      `Scout identified that truck sales typically spike twenty-three percent in your market during the last two weeks of the month, as people try to use end-of-month financing incentives. Your current campaigns aren't targeting this window. I've prepared a burst campaign ready to launch Monday. Want to review it?`,
    acceptLine: () =>
      `Executing now — scheduling the burst campaign to launch Monday so you catch the end-of-month surge. I'll scale the budget with the demand and report the extra pipeline it drives.`,
    dismissLine: () =>
      `Understood — I'll keep the burst campaign on standby so it's ready the moment you want to capture that end-of-month spike.`,
  },
];

// Build the concrete, personalized suggestion objects for the current demo.
function buildSuggestions({ businessName, prospectName } = {}) {
  const business = (businessName || "Premier Auto Group").trim();
  const prospect = (prospectName || "").trim();
  const ctx = { business, prospect };
  return SUGGESTION_DEFS.map((s) => ({
    id: s.id,
    step: s.step,
    agent: s.agent,
    agentColor: AGENT_COLORS[s.agent] || AGENT_COLORS.echo,
    title: s.title,
    action: s.action,
    text: s.text(ctx),
    acceptLine: s.acceptLine(ctx),
    dismissLine: s.dismissLine(ctx),
  }));
}

// Steps that carry a built-in suggestion (used for validation + docs).
const SUGGESTION_STEPS = SUGGESTION_DEFS.map((s) => s.step);

// Suggestion id -> minimum tier that unlocks it. Used to hide higher-tier
// suggestions (e.g. the Enterprise-only competitor threat) from a lower-tier
// demo so each demo only surfaces suggestions for its own unlocked features.
const TIER_RANK = { starter: 1, pro: 2, enterprise: 3 };
const SUGGESTION_TIERS = SUGGESTION_DEFS.reduce((acc, s) => {
  acc[s.id] = s.tier || "starter";
  return acc;
}, {});

// Keep only the suggestions whose feature is unlocked at `tier`.
function filterSuggestionsByTier(suggestions, tier) {
  const max = TIER_RANK[tier] || 1;
  return (suggestions || []).filter(
    (s) => (TIER_RANK[SUGGESTION_TIERS[s.id]] || 1) <= max,
  );
}

// Validate an AI-adapted suggestion set: same length + ids/steps as the
// built-ins, and every spoken field a non-empty string. Returns a normalized
// array (only known fields) or throws so bad AI output never reaches the demo.
function validateAdaptedSuggestions(raw) {
  if (!Array.isArray(raw) || raw.length !== SUGGESTION_DEFS.length) {
    throw new Error("Adapted suggestions must match the built-in set count.");
  }
  const byId = new Map(SUGGESTION_DEFS.map((s) => [s.id, s]));
  const seen = new Set();
  const out = raw.map((item) => {
    const base = item && byId.get(item.id);
    if (!base) throw new Error(`Unknown suggestion id: ${item && item.id}`);
    if (seen.has(base.id)) {
      throw new Error(`Duplicate suggestion id: ${base.id}`);
    }
    seen.add(base.id);
    const str = (v) => (typeof v === "string" ? v.trim() : "");
    const text = str(item.text);
    const acceptLine = str(item.acceptLine);
    const dismissLine = str(item.dismissLine);
    const title = str(item.title) || base.title;
    const action = str(item.action) || base.action;
    if (!text || !acceptLine || !dismissLine) {
      throw new Error(`Adapted suggestion "${base.id}" is missing spoken text.`);
    }
    return {
      id: base.id,
      step: base.step,
      agent: base.agent,
      agentColor: AGENT_COLORS[base.agent] || AGENT_COLORS.echo,
      title,
      action,
      text,
      acceptLine,
      dismissLine,
    };
  });
  return out;
}

module.exports = {
  buildSuggestions,
  validateAdaptedSuggestions,
  filterSuggestionsByTier,
  SUGGESTION_DEFS,
  SUGGESTION_STEPS,
  SUGGESTION_TIERS,
  AGENT_COLORS,
};
