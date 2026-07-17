const db = require("../config/db");
const chatbotController = require("./chatbotController");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/public/brand/:brandId  (PUBLIC — prospects are not authenticated)
 * Returns ONLY the safe, public-facing brand profile used to brand the voice
 * landing page: business name, tagline, and voice description. No owner, no
 * IDs of related records, no internal/sensitive fields.
 */
async function getPublicBrandProfile(req, res) {
  const { brandId } = req.params;

  try {
    const result = await db.query(
      "SELECT brand_name, tagline, voice_description FROM brands WHERE brand_id = $1",
      [brandId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const row = result.rows[0];
    // Return ONLY the safe public fields — nothing else (no ids, no owner).
    return res.json({
      businessName: row.brand_name,
      tagline: row.tagline,
      voiceDescription: row.voice_description,
    });
  } catch (err) {
    console.error("Public brand profile error:", err.message);
    return res.status(500).json({ error: "Failed to load brand profile" });
  }
}

/**
 * POST /api/public/lead/start  (PUBLIC)
 * Creates a brand-linked lead for a prospect who just landed on the voice page
 * and starts the qualification conversation. Returns the lead id and the
 * chatbot's opening greeting (in the brand's voice).
 *
 * Body: { brandId }
 */
async function startLeadConversation(req, res) {
  const { brandId } = req.body;

  if (!brandId) {
    return res.status(400).json({ error: "brandId is required" });
  }

  try {
    const brandResult = await db.query(
      `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
       FROM brands
       WHERE brand_id = $1`,
      [brandId]
    );

    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const brand = brandResult.rows[0];

    // Create the lead up front (contact details captured later in the chat).
    const leadResult = await db.query(
      `INSERT INTO leads (brand_id)
       VALUES ($1)
       RETURNING lead_id, brand_id, temperature`,
      [brandId]
    );
    const lead = leadResult.rows[0];

    // Sage V2 P3 attribution (flag-gated no-op when dark): this lead started
    // on the public voice page — first touch is genuinely known.
    require("../utils/leadOutcome").setFirstTouch(lead.lead_id, "voice").catch(() => {});

    try {
      const greeting = await chatbotController.startConversation(lead, brand);
      return res.status(201).json({ leadId: lead.lead_id, greeting });
    } catch (err) {
      console.error("Voice lead greeting error:", err.message);
      // The lead exists; let the prospect speak even if the greeting failed.
      return res.status(201).json({
        leadId: lead.lead_id,
        greeting: null,
        chatbotError: "Could not start the conversation automatically.",
      });
    }
  } catch (err) {
    console.error("Start lead conversation error:", err.message);
    return res.status(500).json({ error: "Failed to start the conversation" });
  }
}

/**
 * POST /api/public/lead/:leadId/contact  (PUBLIC)
 * Saves the prospect's contact details onto their lead so the business owner
 * can follow up. Temperature scoring continues through the normal chat loop.
 *
 * Body: { name, phone, email }
 */
async function saveLeadContact(req, res) {
  const { leadId } = req.params;
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";

  if (!name || !phone || !email) {
    return res
      .status(400)
      .json({ error: "Name, phone, and email are required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  try {
    const result = await db.query(
      `UPDATE leads
         SET lead_name = $1, phone = $2, email = $3
       WHERE lead_id = $4
       RETURNING lead_id`,
      [name, phone, email, leadId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Save lead contact error:", err.message);
    return res.status(500).json({ error: "Failed to save contact details" });
  }
}

module.exports = {
  getPublicBrandProfile,
  startLeadConversation,
  saveLeadContact,
};
