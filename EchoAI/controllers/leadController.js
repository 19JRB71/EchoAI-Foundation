const db = require("../config/db");
const chatbotController = require("./chatbotController");
const zapierController = require("./zapierController");
const followUpController = require("./followUpController");

/**
 * Verifies that a brand belongs to the authenticated user.
 * Returns the brand row, or null if not found / not owned.
 */
async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Verifies that a lead belongs to a brand owned by the authenticated user.
 * Returns the lead row, or null.
 */
async function getOwnedLead(leadId, userId) {
  const result = await db.query(
    `SELECT l.*
     FROM leads l
     JOIN brands b ON b.brand_id = l.brand_id
     WHERE l.lead_id = $1 AND b.user_id = $2`,
    [leadId, userId]
  );
  return result.rows[0] || null;
}

/**
 * POST /api/leads
 * Creates a lead (default temperature tire_kicker) and triggers the
 * qualification chatbot to start the conversation.
 */
async function createLead(req, res) {
  const userId = req.user.userId;
  const { name, email, phone, brandId } = req.body;

  if (!brandId) {
    return res.status(400).json({ error: "brandId is required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const inserted = await db.query(
      `INSERT INTO leads (brand_id, lead_name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING lead_id, brand_id, lead_name, email, phone, temperature,
                 conversion_status, created_at`,
      [brandId, name || null, email || null, phone || null]
    );
    const lead = inserted.rows[0];

    // Fire the new-lead webhook (Zapier etc.). Fire-and-forget — never blocks
    // the response and never throws.
    zapierController.triggerWebhook(brandId, "new_lead_created", {
      leadId: lead.lead_id,
      name: lead.lead_name,
      email: lead.email,
      phone: lead.phone,
      temperature: lead.temperature,
      conversionStatus: lead.conversion_status,
    });

    // Trigger the qualification chatbot to open the conversation. If the AI call
    // fails (e.g. missing API key), still return the created lead.
    let openingMessage = null;
    let chatbotError = null;
    try {
      openingMessage = await chatbotController.startConversation(lead, brand);
    } catch (err) {
      chatbotError = "Lead created, but the chatbot could not start the conversation.";
      console.error("Chatbot start error:", err.message);
    }

    return res.status(201).json({ lead, openingMessage, chatbotError });
  } catch (err) {
    console.error("Create lead error:", err.message);
    return res.status(500).json({ error: "Failed to create lead" });
  }
}

/**
 * GET /api/leads?brandId=...&temperature=...
 * Returns all leads for a brand, optionally filtered by temperature.
 */
async function getLeads(req, res) {
  const userId = req.user.userId;
  const { brandId, temperature } = req.query;

  if (!brandId) {
    return res.status(400).json({ error: "brandId query parameter is required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const params = [brandId];
    let sql =
      `SELECT lead_id, brand_id, lead_name, email, phone, temperature,
              conversion_status, created_at, updated_at
       FROM leads
       WHERE brand_id = $1`;

    if (temperature) {
      params.push(temperature);
      sql += ` AND temperature = $${params.length}`;
    }
    sql += " ORDER BY created_at DESC";

    const result = await db.query(sql, params);
    return res.json({ count: result.rows.length, leads: result.rows });
  } catch (err) {
    console.error("Get leads error:", err.message);
    return res.status(500).json({ error: "Failed to fetch leads" });
  }
}

/**
 * GET /api/leads/:leadId
 * Returns the complete lead record, including full conversation history and all
 * CRM interactions.
 */
async function getLeadProfile(req, res) {
  const userId = req.user.userId;
  const { leadId } = req.params;

  try {
    const lead = await getOwnedLead(leadId, userId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const interactions = await db.query(
      `SELECT interaction_id, interaction_type, interaction_details, occurred_at, created_at
       FROM crm_interactions
       WHERE lead_id = $1
       ORDER BY occurred_at ASC`,
      [leadId]
    );

    return res.json({ lead, interactions: interactions.rows });
  } catch (err) {
    console.error("Get lead profile error:", err.message);
    return res.status(500).json({ error: "Failed to fetch lead profile" });
  }
}

/**
 * PUT /api/leads/:leadId
 * Manually updates temperature, conversion status, and/or contact details.
 */
async function updateLead(req, res) {
  const userId = req.user.userId;
  const { leadId } = req.params;
  const { name, email, phone, temperature, conversionStatus } = req.body;

  try {
    const lead = await getOwnedLead(leadId, userId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`lead_name = $${idx++}`);
      values.push(name);
    }
    if (email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(email);
    }
    if (phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(phone);
    }
    if (temperature !== undefined) {
      fields.push(`temperature = $${idx++}`);
      values.push(temperature);
    }
    if (conversionStatus !== undefined) {
      fields.push(`conversion_status = $${idx++}`);
      values.push(conversionStatus);
    }

    // A converted lead no longer needs any running follow-up — stop them.
    if (conversionStatus === "converted") {
      followUpController
        .cancelActiveSequencesForLead(leadId, "converted")
        .catch((err) => console.error("Follow-up stop (convert) failed:", err.message));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    values.push(leadId);

    const result = await db.query(
      `UPDATE leads SET ${fields.join(", ")}
       WHERE lead_id = $${idx}
       RETURNING lead_id, brand_id, lead_name, email, phone, temperature,
                 conversion_status, updated_at`,
      values
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update lead error:", err.message);
    return res.status(500).json({ error: "Failed to update lead" });
  }
}

/**
 * POST /api/leads/:leadId/convert
 * Marks a lead as converted and logs the conversion in the CRM interactions table.
 */
async function convertLead(req, res) {
  const userId = req.user.userId;
  const { leadId } = req.params;
  const { notes } = req.body;

  try {
    const lead = await getOwnedLead(leadId, userId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const updated = await db.query(
      `UPDATE leads SET conversion_status = 'converted'
       WHERE lead_id = $1
       RETURNING lead_id, brand_id, lead_name, email, phone, temperature,
                 conversion_status, updated_at`,
      [leadId]
    );

    await db.query(
      `INSERT INTO crm_interactions (lead_id, interaction_type, interaction_details)
       VALUES ($1, 'conversion', $2::jsonb)`,
      [leadId, JSON.stringify({ notes: notes || null, convertedAt: new Date().toISOString() })]
    );

    // Stop any running follow-up — the lead has converted.
    followUpController
      .cancelActiveSequencesForLead(leadId, "converted")
      .catch((err) => console.error("Follow-up stop (convert) failed:", err.message));

    return res.json({ message: "Lead converted", lead: updated.rows[0] });
  } catch (err) {
    console.error("Convert lead error:", err.message);
    return res.status(500).json({ error: "Failed to convert lead" });
  }
}

module.exports = {
  createLead,
  getLeads,
  getLeadProfile,
  updateLead,
  convertLead,
};
