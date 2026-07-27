/**
 * Mobile data controller (/api/v2).
 *
 * Lean, mobile-optimized read endpoints for the native app's core screens:
 *   - getDashboard: the three key metrics for the Home screen.
 *   - getLeads:     the CRM list, CURSOR-paginated for smooth infinite scroll.
 *
 * All responses use the standard mobile envelope (utils/mobileResponse). Payloads
 * are intentionally lean — only the fields the mobile UI renders.
 */

const db = require("../config/db");
const { success, fail, parseLimit, decodeCursor, paginate } = require("../utils/mobileResponse");

/** Confirm a brand belongs to the authenticated user. */
async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    "SELECT brand_id, brand_name FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/**
 * GET /api/v2/dashboard/:brandId
 * Returns the three key metrics (total spend, total leads, cost per lead) from the
 * most recent weekly analytics record. 404 if the brand has no analytics yet.
 */
async function getDashboard(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return fail(res, { status: 404, message: "Brand not found" });
    }

    const result = await db.query(
      `SELECT week_date, total_spend, total_leads, cost_per_lead
       FROM analytics
       WHERE brand_id = $1
       ORDER BY week_date DESC
       LIMIT 1`,
      [brandId]
    );

    if (result.rows.length === 0) {
      return fail(res, { status: 404, message: "No analytics recorded yet for this brand" });
    }

    const a = result.rows[0];
    return success(res, {
      message: "Dashboard metrics",
      data: {
        brandId: brand.brand_id,
        brandName: brand.brand_name,
        weekDate: a.week_date,
        metrics: {
          totalSpend: Number(a.total_spend),
          totalLeads: Number(a.total_leads),
          costPerLead: a.cost_per_lead !== null ? Number(a.cost_per_lead) : null,
        },
      },
    });
  } catch (err) {
    console.error("Mobile dashboard error:", err.message);
    return fail(res, { status: 500, message: "Failed to fetch dashboard" });
  }
}

/**
 * GET /api/v2/leads?brandId=...&temperature=...&cursor=...&limit=...
 * Cursor-paginated CRM leads (newest first), with a lean payload for the mobile
 * list. The cursor encodes the last row's (created_at, lead_id) so paging is
 * stable even as new leads arrive.
 */
async function getLeads(req, res) {
  const userId = req.user.userId;
  const { brandId, temperature, cursor } = req.query;

  if (!brandId) {
    return fail(res, { status: 400, message: "brandId query parameter is required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return fail(res, { status: 404, message: "Brand not found" });
    }

    const limit = parseLimit(req.query.limit);
    const params = [brandId];
    let sql = `SELECT lead_id, lead_name, email, phone, temperature, conversion_status, created_at
               FROM leads
               WHERE brand_id = $1`;

    if (temperature) {
      params.push(temperature);
      sql += ` AND temperature = $${params.length}`;
    }

    // Keyset pagination: rows strictly "older" than the cursor (created_at, id).
    const decoded = decodeCursor(cursor);
    if (decoded) {
      params.push(decoded.createdAt, decoded.id);
      sql += ` AND (created_at, lead_id) < ($${params.length - 1}, $${params.length})`;
    }

    // Fetch one extra row to detect whether another page exists.
    params.push(limit + 1);
    sql += ` ORDER BY created_at DESC, lead_id DESC LIMIT $${params.length}`;

    const result = await db.query(sql, params);
    const { items, pagination } = paginate(result.rows, limit, (row) => ({
      createdAt: row.created_at,
      id: row.lead_id,
    }));

    const leads = items.map((l) => ({
      leadId: l.lead_id,
      name: l.lead_name,
      email: l.email,
      phone: l.phone,
      temperature: l.temperature,
      conversionStatus: l.conversion_status,
      createdAt: l.created_at,
    }));

    return success(res, { message: "Leads", data: leads, pagination });
  } catch (err) {
    console.error("Mobile leads error:", err.message);
    return fail(res, { status: 500, message: "Failed to fetch leads" });
  }
}

module.exports = { getDashboard, getLeads };
