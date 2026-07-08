// Echo "navigate first, ask before reading" support.
//
// When a voice command navigates the owner to a section, Echo never reads the
// content automatically — it asks first ("Want me to read the highlights?").
// This controller powers both halves of that flow with REAL data:
//
//   GET  /api/echo/section-offer?section=<key>  → { question }
//        The question Echo asks right after navigating (may include live
//        counts, e.g. "You have 12 leads right now, including 3 hot leads.").
//
//   POST /api/echo/section-brief { section }    → { text }
//        The spoken readout Echo delivers ONLY after the owner says yes.
//
// Readouts are composed deterministically from the database — no AI call — so
// they work even when the AI provider is down and can never invent numbers.
// Demo brands are excluded from every query (real data only).

const db = require("../config/db");

const SECTIONS = new Set(["leads", "campaigns", "sage"]);

async function ownedBrandIds(userId) {
  const r = await db.query(
    `SELECT brand_id FROM brands WHERE user_id = $1 AND is_demo = false`,
    [userId]
  );
  return r.rows.map((row) => row.brand_id);
}

function plural(n, singular, pluralWord) {
  return `${n} ${n === 1 ? singular : pluralWord || `${singular}s`}`;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

async function leadCounts(brandIds) {
  if (brandIds.length === 0) return { total: 0, hot: 0 };
  const r = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot
       FROM leads WHERE brand_id = ANY($1)`,
    [brandIds]
  );
  return r.rows[0] || { total: 0, hot: 0 };
}

function leadsOfferText({ total, hot }) {
  if (total === 0) {
    return "I've opened your leads. You don't have any leads yet — want me to explain how to start bringing some in?";
  }
  const hotPart = hot > 0 ? `, including ${plural(hot, "hot lead")}` : "";
  return `You have ${plural(total, "lead")} right now${hotPart}. Want me to walk you through them?`;
}

async function leadsBrief(brandIds) {
  const counts = await leadCounts(brandIds);
  if (counts.total === 0) {
    return "You don't have any leads yet. Once your chatbot or campaigns start capturing them, they'll show up here and I can walk you through each one.";
  }
  const r = await db.query(
    `SELECT lead_name, temperature, conversion_status
       FROM leads WHERE brand_id = ANY($1)
      ORDER BY (temperature = 'hot') DESC, created_at DESC
      LIMIT 5`,
    [brandIds]
  );
  const lines = r.rows.map((l) => {
    const name = (l.lead_name || "").trim() || "An unnamed lead";
    const temp =
      l.temperature === "hot"
        ? "a hot lead"
        : l.temperature === "warm"
          ? "a warm lead"
          : "an early-stage lead";
    return `${name} — ${temp}, status ${String(l.conversion_status || "new").replace(/_/g, " ")}`;
  });
  const hotPart =
    counts.hot > 0
      ? ` ${plural(counts.hot, "of them is a hot lead", "of them are hot leads")} — worth reaching out to today.`
      : "";
  return `Here's the rundown. You have ${plural(counts.total, "lead")} in total.${hotPart} The most important ones: ${lines.join(". ")}. That's the picture — the full list is on your screen.`;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

async function campaignRows(userId, brandIds) {
  if (brandIds.length === 0) return [];
  const r = await db.query(
    `SELECT campaign_name, budget, cost_per_lead, conversion_rate, launch_date
       FROM campaigns
      WHERE user_id = $1 AND brand_id = ANY($2)
      ORDER BY created_at DESC
      LIMIT 5`,
    [userId, brandIds]
  );
  return r.rows;
}

function campaignsOfferText(count) {
  if (count === 0) {
    return "I've opened your campaigns. You don't have any campaigns yet — want me to explain how to launch your first one?";
  }
  return `I've opened your campaigns — you have ${plural(count, "campaign")}. Want me to summarize how they're performing?`;
}

function money(n) {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v % 1 === 0 ? `$${v}` : `$${v.toFixed(2)}`;
}

function campaignsBriefText(rows) {
  if (rows.length === 0) {
    return "You don't have any campaigns yet. When you're ready, Atlas can prepare your first ad campaign and you approve it before anything runs.";
  }
  const lines = rows.map((c) => {
    const parts = [c.campaign_name];
    const b = money(c.budget);
    if (b) parts.push(`budget ${b}`);
    const cpl = money(c.cost_per_lead);
    if (cpl) parts.push(`about ${cpl} per lead`);
    const cr = Number(c.conversion_rate);
    if (Number.isFinite(cr) && cr > 0)
      parts.push(`converting at ${(cr * 100).toFixed(1).replace(/\.0$/, "")} percent`);
    return parts.join(", ");
  });
  return `Here's how your campaigns look. ${lines.join(". ")}. The full breakdown is on your screen.`;
}

// ---------------------------------------------------------------------------
// Sage (industry intelligence report)
// ---------------------------------------------------------------------------

async function sageProfile(brandIds) {
  if (brandIds.length === 0) return null;
  const r = await db.query(
    `SELECT summary, marketing_insights, last_refreshed_at
       FROM sage_intelligence_profiles
      WHERE brand_id = ANY($1) AND last_refreshed_at IS NOT NULL
      ORDER BY last_refreshed_at DESC
      LIMIT 1`,
    [brandIds]
  );
  return r.rows[0] || null;
}

function sageOfferText(profile) {
  if (!profile) {
    return "I've opened Sage's intelligence page. Sage hasn't finished a report yet — want me to explain what Sage will put together for you?";
  }
  return "I've opened Sage's latest intelligence report. Would you like me to read the highlights to you?";
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sageBriefText(profile) {
  if (!profile) {
    return "Sage hasn't finished an intelligence report yet. Sage researches your industry on a rolling basis — real trends, competitor moves, and recommendations — and the report will appear here once the first research cycle completes.";
  }
  const parts = [];
  const summary = (profile.summary || "").trim();
  if (summary) parts.push(summary);
  const insights = asArray(profile.marketing_insights)
    .slice(0, 3)
    .map((i) => (i && typeof i.insight === "string" ? i.insight.trim() : ""))
    .filter(Boolean);
  if (insights.length > 0) {
    parts.push(`Top recommendations: ${insights.join(". ")}.`);
  }
  if (parts.length === 0) {
    return "Sage's report is still being assembled — check back shortly and I'll read it to you.";
  }
  return `Here are the highlights from Sage's report. ${parts.join(" ")} The full report is on your screen.`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function sectionOffer(req, res) {
  try {
    const section = String(req.query.section || "").trim();
    if (!SECTIONS.has(section)) {
      return res.status(400).json({ error: "Unknown section" });
    }
    const brandIds = await ownedBrandIds(req.user.userId);
    let question;
    if (section === "leads") {
      question = leadsOfferText(await leadCounts(brandIds));
    } else if (section === "campaigns") {
      const rows = await campaignRows(req.user.userId, brandIds);
      question = campaignsOfferText(rows.length);
    } else {
      question = sageOfferText(await sageProfile(brandIds));
    }
    return res.json({ section, question });
  } catch (err) {
    console.error("Echo section-offer error:", err.message);
    return res.status(500).json({ error: "Couldn't prepare that just now." });
  }
}

async function sectionBrief(req, res) {
  try {
    const section = String((req.body && req.body.section) || "").trim();
    if (!SECTIONS.has(section)) {
      return res.status(400).json({ error: "Unknown section" });
    }
    const brandIds = await ownedBrandIds(req.user.userId);
    let text;
    if (section === "leads") {
      text = await leadsBrief(brandIds);
    } else if (section === "campaigns") {
      text = campaignsBriefText(await campaignRows(req.user.userId, brandIds));
    } else {
      text = sageBriefText(await sageProfile(brandIds));
    }
    return res.json({ section, text });
  } catch (err) {
    console.error("Echo section-brief error:", err.message);
    return res.status(500).json({ error: "Couldn't pull that up just now." });
  }
}

module.exports = {
  sectionOffer,
  sectionBrief,
  // Exported for tests (pure text composers).
  leadsOfferText,
  campaignsOfferText,
  campaignsBriefText,
  sageOfferText,
  sageBriefText,
};
