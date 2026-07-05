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
    `SELECT active, business_name, prospect_name, demo_brand_id, morning_briefing, seeded_at
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
  };
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

  const cfg = await readConfig();
  const nextBusiness =
    typeof businessNameRaw === "string" && businessNameRaw.trim()
      ? businessNameRaw.trim()
      : (cfg && cfg.business_name) || DEMO_BUSINESS_DEFAULT;
  const nextProspect =
    typeof prospectNameRaw === "string" ? prospectNameRaw.trim() : (cfg && cfg.prospect_name) || null;

  const { buildMorningBriefing } = require("../utils/demoSeeder");
  const briefing = buildMorningBriefing(nextBusiness, nextProspect);

  await db.query(
    `UPDATE demo_config
       SET business_name = $1, prospect_name = $2, morning_briefing = $3, updated_at = NOW()
     WHERE id = true`,
    [nextBusiness, nextProspect || null, briefing]
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
  res.json({ lines, steps: DEMO_STEPS, ...shaped });
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
};
