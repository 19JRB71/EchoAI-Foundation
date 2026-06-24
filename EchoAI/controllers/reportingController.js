const db = require("../config/db");
const analyticsController = require("./analyticsController");

/**
 * POST /api/analytics/:brandId/report
 * Generates the weekly report email for a brand: pulls the brand profile and the
 * latest analytics, calls Anthropic to write a plain-language summary, formats it
 * as a clean email, and logs that the report was sent in the CRM interactions table.
 */
async function generateReport(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await analyticsController.getOwnedBrand(brandId, userId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const analyticsResult = await db.query(
      `SELECT week_date, total_spend, total_leads, cost_per_lead, conversions, return_on_ad_spend
       FROM analytics
       WHERE brand_id = $1
       ORDER BY week_date DESC
       LIMIT 1`,
      [brandId]
    );

    if (analyticsResult.rows.length === 0) {
      return res.status(404).json({
        error: "No analytics recorded yet for this brand. Record analytics before generating a report.",
      });
    }

    const analytics = analyticsResult.rows[0];

    // Recipient is the business owner.
    const ownerResult = await db.query("SELECT email FROM users WHERE user_id = $1", [userId]);
    const recipient = ownerResult.rows[0] ? ownerResult.rows[0].email : null;

    const { subject, body } = await analyticsController.generateWeeklyReport(brand, analytics);

    const email = { to: recipient, subject, body };

    // Log that the report was sent.
    await db.query(
      `INSERT INTO crm_interactions (brand_id, interaction_type, interaction_details)
       VALUES ($1, 'weekly_report', $2::jsonb)`,
      [
        brandId,
        JSON.stringify({
          subject,
          recipient,
          weekOf: analytics.week_date,
          sentAt: new Date().toISOString(),
        }),
      ]
    );

    return res.json({ message: "Weekly report generated", email });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Generate report error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to generate weekly report" });
  }
}

module.exports = { generateReport };
