// Demo Account & Sales Presentation Mode — admin-only controller.
//
// All routes are mounted under /api/admin/demo and protected by auth + admin
// middleware. The demo is a single flagged brand under the admin account; these
// endpoints seed/reset it, toggle Presentation Mode, edit the demo business +
// prospect name, and return the templated Echo voice script for the presenter.

const db = require("../config/db");
const emailController = require("./emailController");
const { seedDemo, DEMO_BUSINESS_DEFAULT } = require("../utils/demoSeeder");
const { buildDemoScript, DEMO_STEPS } = require("../config/demoScript");
const {
  buildSuggestions,
  validateAdaptedSuggestions,
  SUGGESTION_DEFS,
} = require("../config/demoSuggestions");
const { createMessage, MODEL } = require("../config/anthropic");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public demo-request handler for the marketing landing page. Requires no
 * authentication. Records the prospect as a 'platform_inquiry' and fires an
 * admin notification email (best-effort) so the platform owner can call back.
 */
async function submitDemoRequest(req, res) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const businessType =
    typeof req.body.businessType === "string"
      ? req.body.businessType.trim()
      : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";

  if (!name || !businessType || !phone || !email) {
    return res
      .status(400)
      .json({ error: "Name, business type, phone, and email are required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  try {
    const result = await db.query(
      `INSERT INTO platform_inquiries (name, business_type, phone, email, inquiry_type)
       VALUES ($1, $2, $3, $4, 'platform_inquiry')
       RETURNING inquiry_id`,
      [name, businessType, phone, email]
    );

    // Notify the platform owner. Best-effort: never fail the prospect's
    // submission just because the notification email couldn't be sent.
    emailController
      .sendPlatformInquiryNotification({ name, businessType, phone, email })
      .catch((err) =>
        console.error("Platform inquiry notification email error:", err.message)
      );

    return res.status(201).json({
      success: true,
      inquiryId: result.rows[0].inquiry_id,
      message: "Thanks! We'll call you within 24 hours.",
    });
  } catch (err) {
    console.error("Demo request error:", err.message);
    return res
      .status(500)
      .json({ error: "Something went wrong. Please try again." });
  }
}

async function readConfig() {
  const res = await db.query(
    `SELECT active, business_name, prospect_name, demo_brand_id, morning_briefing, seeded_at,
            suggestions_enabled, custom_scenario, custom_suggestions
       FROM demo_config WHERE id = true`
  );
  return res.rows[0] || null;
}

function shape(cfg) {
  return {
    active: !!(cfg && cfg.active),
    businessName: (cfg && cfg.business_name) || DEMO_BUSINESS_DEFAULT,
    prospectName: (cfg && cfg.prospect_name) || "",
    demoBrandId: (cfg && cfg.demo_brand_id) || null,
    morningBriefing: (cfg && cfg.morning_briefing) || "",
    seeded: !!(cfg && cfg.seeded_at),
    seededAt: (cfg && cfg.seeded_at) || null,
    // Live in-demo AI suggestions.
    suggestionsEnabled: cfg ? cfg.suggestions_enabled !== false : true,
    customScenario: (cfg && cfg.custom_scenario) || "",
    hasCustomSuggestions: !!(cfg && cfg.custom_suggestions),
  };
}

// Resolve the suggestion set for the current demo: the AI-adapted custom set
// when one is stored, otherwise the built-in Premier Auto Group suggestions,
// always personalized with the current business + prospect name.
function resolveSuggestions(cfg, shaped) {
  const custom = cfg && cfg.custom_suggestions;
  if (Array.isArray(custom) && custom.length) {
    try {
      return validateAdaptedSuggestions(custom);
    } catch (err) {
      // A stored set that no longer validates (e.g. code changed) falls back to
      // the built-ins rather than breaking the demo.
      console.warn("Stored demo suggestions invalid, using defaults:", err.message);
    }
  }
  return buildSuggestions({
    businessName: shaped.businessName,
    prospectName: shaped.prospectName,
  });
}

// GET /api/admin/demo/status
async function getStatus(req, res) {
  const cfg = await readConfig();
  res.json(shape(cfg));
}

// POST /api/admin/demo/seed  — create/refresh the demo dataset.
async function seed(req, res) {
  try {
    const result = await seedDemo({ businessName: req.body && req.body.businessName });
    const cfg = await readConfig();
    res.json({ ...shape(cfg), result });
  } catch (err) {
    console.error("Demo seed failed:", err.message);
    res.status(500).json({ error: "Failed to seed the demo account." });
  }
}

// POST /api/admin/demo/reset — identical to seed (idempotent wipe + reseed).
async function reset(req, res) {
  try {
    const result = await seedDemo({});
    const cfg = await readConfig();
    res.json({ ...shape(cfg), result });
  } catch (err) {
    console.error("Demo reset failed:", err.message);
    res.status(500).json({ error: "Failed to reset the demo account." });
  }
}

// POST /api/admin/demo/activate — turn Presentation Mode on (must be seeded).
async function activate(req, res) {
  const cfg = await readConfig();
  if (!cfg || !cfg.demo_brand_id) {
    return res
      .status(400)
      .json({ error: "Seed the demo account before starting Presentation Mode." });
  }
  await db.query("UPDATE demo_config SET active = true, updated_at = NOW() WHERE id = true");
  res.json(shape(await readConfig()));
}

// POST /api/admin/demo/deactivate
async function deactivate(req, res) {
  await db.query("UPDATE demo_config SET active = false, updated_at = NOW() WHERE id = true");
  res.json(shape(await readConfig()));
}

// PUT /api/admin/demo/config — edit business + prospect name. If the business
// name changes and the demo is already seeded, rename the brand and rebuild the
// stored morning briefing so the demo stays consistent.
async function updateConfig(req, res) {
  const businessNameRaw = req.body && req.body.businessName;
  const prospectNameRaw = req.body && req.body.prospectName;
  const suggestionsEnabledRaw = req.body && req.body.suggestionsEnabled;

  const cfg = await readConfig();
  const nextBusiness =
    typeof businessNameRaw === "string" && businessNameRaw.trim()
      ? businessNameRaw.trim()
      : (cfg && cfg.business_name) || DEMO_BUSINESS_DEFAULT;
  const nextProspect =
    typeof prospectNameRaw === "string" ? prospectNameRaw.trim() : (cfg && cfg.prospect_name) || null;
  const nextSuggestionsEnabled =
    typeof suggestionsEnabledRaw === "boolean"
      ? suggestionsEnabledRaw
      : cfg
        ? cfg.suggestions_enabled !== false
        : true;

  const { buildMorningBriefing } = require("../utils/demoSeeder");
  const briefing = buildMorningBriefing(nextBusiness, nextProspect);

  await db.query(
    `UPDATE demo_config
       SET business_name = $1, prospect_name = $2, morning_briefing = $3,
           suggestions_enabled = $4, updated_at = NOW()
     WHERE id = true`,
    [nextBusiness, nextProspect || null, briefing, nextSuggestionsEnabled]
  );

  if (cfg && cfg.demo_brand_id) {
    await db.query("UPDATE brands SET brand_name = $1, updated_at = NOW() WHERE brand_id = $2 AND is_demo = true", [
      nextBusiness,
      cfg.demo_brand_id,
    ]);
  }

  res.json(shape(await readConfig()));
}

// GET /api/admin/demo/script — templated Echo lines + toolbar step definitions.
async function getScript(req, res) {
  const cfg = await readConfig();
  const shaped = shape(cfg);
  const lines = buildDemoScript({
    businessName: shaped.businessName,
    prospectName: shaped.prospectName,
    morningBriefing: shaped.morningBriefing,
  });
  const suggestions = resolveSuggestions(cfg, shaped);
  res.json({ lines, steps: DEMO_STEPS, suggestions, ...shaped });
}

// POST /api/admin/demo/suggestions/adapt — free-form scenario mode. The
// presenter describes the prospect's business ("they run a restaurant") and the
// AI rewrites the five built-in suggestions to reference that world, keeping the
// same structure (id/step/agent) so the demo wiring is unchanged. An empty
// scenario clears the custom set and reverts to the built-in suggestions.
async function adaptSuggestions(req, res) {
  const scenarioRaw = req.body && req.body.scenario;
  const scenario = typeof scenarioRaw === "string" ? scenarioRaw.trim() : "";

  const cfg = await readConfig();
  const shaped = shape(cfg);

  // Empty scenario => clear customization.
  if (!scenario) {
    await db.query(
      `UPDATE demo_config SET custom_scenario = NULL, custom_suggestions = NULL, updated_at = NOW()
         WHERE id = true`
    );
    const suggestions = buildSuggestions({
      businessName: shaped.businessName,
      prospectName: shaped.prospectName,
    });
    return res.json({ scenario: "", hasCustomSuggestions: false, suggestions });
  }

  const template = SUGGESTION_DEFS.map((s) => ({
    id: s.id,
    step: s.step,
    agent: s.agent,
    title: s.title,
    action: s.action,
    text: s.text({ business: shaped.businessName, prospect: shaped.prospectName }),
    acceptLine: s.acceptLine({ business: shaped.businessName, prospect: shaped.prospectName }),
    dismissLine: s.dismissLine({ business: shaped.businessName, prospect: shaped.prospectName }),
  }));

  const system =
    "You adapt a fixed set of 5 live sales-demo AI marketing suggestions to a new " +
    "business scenario. You will receive the scenario and a JSON array of the 5 " +
    "suggestions. Rewrite ONLY the human-facing wording (title, action, text, " +
    "acceptLine, dismissLine) so every example fits the new scenario naturally " +
    "(products, channels, seasonality, competitors relevant to that business). " +
    "Keep each suggestion's intent identical: (1) budget reallocation between two " +
    "days, (2) competitor threat + counter-campaign, (3) social channel rebalance, " +
    "(4) untouched high-intent lead follow-up, (5) seasonal opportunity burst. " +
    "text is what Echo says to pitch the idea and MUST end with a question. " +
    "acceptLine is what Echo says after the presenter accepts (start with " +
    "'Executing' or 'Sending'). dismissLine is a graceful acknowledgement. Keep " +
    "each field to 1-3 spoken sentences, no emojis, no markdown. Return ONLY a " +
    "JSON array with the SAME ids and the fields id, title, action, text, " +
    "acceptLine, dismissLine. Do not add or remove items.";

  let adapted;
  try {
    const raw = await createMessage({
      model: MODEL,
      max_tokens: 1600,
      system,
      messages: [
        {
          role: "user",
          content:
            `Scenario: ${scenario}\n\nBusiness name: ${shaped.businessName}\n` +
            `Prospect name: ${shaped.prospectName || "(none)"}\n\n` +
            `Suggestions to adapt:\n${JSON.stringify(template, null, 2)}`,
        },
      ],
    }, { label: "demo suggestions adapt", timeout: 60000 });
    const text = raw && raw.content && raw.content[0] && raw.content[0].text;
    if (!text) throw new Error("Empty AI response");
    const match = text.match(/\[[\s\S]*\]/);
    adapted = JSON.parse(match ? match[0] : text);
  } catch (err) {
    // Anthropic SDK errors lack a usable .status — force 502 for upstream AI
    // failures so the client shows a real error, never mocked suggestions.
    console.error("adaptSuggestions AI error:", err.message);
    return res.status(502).json({ error: "The AI service is temporarily unavailable. Please try again." });
  }

  let normalized;
  try {
    normalized = validateAdaptedSuggestions(adapted);
  } catch (err) {
    return res.status(502).json({ error: "The AI returned an unexpected format. Please try again." });
  }

  // Store only the human-facing fields (agent/step/color are re-derived on read).
  const toStore = normalized.map((s) => ({
    id: s.id,
    title: s.title,
    action: s.action,
    text: s.text,
    acceptLine: s.acceptLine,
    dismissLine: s.dismissLine,
  }));

  await db.query(
    `UPDATE demo_config SET custom_scenario = $1, custom_suggestions = $2::jsonb, updated_at = NOW()
       WHERE id = true`,
    [scenario, JSON.stringify(toStore)]
  );

  res.json({ scenario, hasCustomSuggestions: true, suggestions: normalized });
}

module.exports = {
  submitDemoRequest,
  getStatus,
  seed,
  reset,
  activate,
  deactivate,
  updateConfig,
  getScript,
  adaptSuggestions,
};
