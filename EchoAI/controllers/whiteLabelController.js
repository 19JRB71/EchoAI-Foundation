const db = require("../config/db");
const {
  DEFAULT_BRANDING,
  isHexColor,
  isValidDomain,
  normalizeDomain,
  isValidEmail,
  isValidLogoUrl,
} = require("../config/whiteLabel");

/** Shapes a DB agency row into the camelCase object the client expects. */
function serializeAgency(row) {
  return {
    agencyId: row.agency_id,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    agencyName: row.agency_name,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    customDomain: row.custom_domain,
    supportEmail: row.support_email,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Loads the agency owned by a given user (the Agency Portal's single agency). */
async function getOwnedAgency(userId) {
  const { rows } = await db.query(
    `SELECT a.*, u.email AS owner_email
     FROM agencies a
     JOIN users u ON u.user_id = a.owner_user_id
     WHERE a.owner_user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * POST /api/agencies  (admin only)
 * Creates a new white-label agency. By default the agency is linked to the
 * authenticated admin, but the platform owner can assign it to an existing user
 * account via `ownerEmail` so that user becomes the agency owner (and sees the
 * Agency Portal). Each user can own at most one agency.
 */
async function createAgency(req, res) {
  const {
    agencyName,
    logoUrl,
    primaryColor,
    secondaryColor,
    customDomain,
    supportEmail,
    ownerEmail,
  } = req.body;

  if (!agencyName || !String(agencyName).trim()) {
    return res.status(400).json({ error: "agencyName is required" });
  }
  if (primaryColor && !isHexColor(primaryColor)) {
    return res.status(400).json({ error: "primaryColor must be a hex color (e.g. #2563eb)" });
  }
  if (secondaryColor && !isHexColor(secondaryColor)) {
    return res.status(400).json({ error: "secondaryColor must be a hex color (e.g. #111827)" });
  }
  if (customDomain && !isValidDomain(customDomain)) {
    return res.status(400).json({ error: "customDomain must be a bare hostname (e.g. app.agency.com)" });
  }
  if (supportEmail && !isValidEmail(supportEmail)) {
    return res.status(400).json({ error: "supportEmail must be a valid email address" });
  }
  if (logoUrl && !isValidLogoUrl(logoUrl)) {
    return res.status(400).json({ error: "logoUrl must be a valid http(s) URL" });
  }

  try {
    // Resolve the owner: an explicit ownerEmail (assign to that user) or the
    // authenticated admin by default.
    let ownerUserId = req.user.userId;
    if (ownerEmail && String(ownerEmail).trim()) {
      const { rows } = await db.query(
        `SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)`,
        [String(ownerEmail).trim()],
      );
      if (!rows.length) {
        return res.status(404).json({ error: "No user found with that ownerEmail" });
      }
      ownerUserId = rows[0].user_id;
    }

    const { rows } = await db.query(
      `INSERT INTO agencies
         (owner_user_id, agency_name, logo_url, primary_color, secondary_color,
          custom_domain, support_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        ownerUserId,
        String(agencyName).trim(),
        logoUrl ? String(logoUrl).trim() : null,
        primaryColor || null,
        secondaryColor || null,
        customDomain ? normalizeDomain(customDomain) : null,
        supportEmail ? String(supportEmail).trim() : null,
      ],
    );

    const created = await getOwnedAgency(ownerUserId);
    return res.status(201).json({ agency: serializeAgency(created || rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      // Unique violation — owner already has an agency, or the domain is taken.
      const taken = /custom_domain/.test(err.detail || "")
        ? "That custom domain is already in use."
        : "That user already owns an agency.";
      return res.status(409).json({ error: taken });
    }
    console.error("Create agency error:", err.message);
    return res.status(500).json({ error: "Failed to create agency" });
  }
}

/**
 * GET /api/agencies/all  (admin only)
 * Platform-owner overview: every agency with its customer count and monthly
 * revenue, plus platform-wide totals.
 */
async function listAllAgencies(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT a.*, u.email AS owner_email,
              COUNT(ac.agency_customer_id)::int AS customer_count,
              COALESCE(SUM(ac.monthly_price), 0)::float AS monthly_revenue
       FROM agencies a
       JOIN users u ON u.user_id = a.owner_user_id
       LEFT JOIN agency_customers ac ON ac.agency_id = a.agency_id
       GROUP BY a.agency_id, u.email
       ORDER BY a.created_at DESC`,
    );

    const agencies = rows.map((r) => ({
      ...serializeAgency(r),
      customerCount: r.customer_count,
      monthlyRevenue: r.monthly_revenue,
    }));
    const totals = agencies.reduce(
      (acc, a) => {
        acc.agencies += 1;
        acc.customers += a.customerCount;
        acc.monthlyRevenue += a.monthlyRevenue;
        return acc;
      },
      { agencies: 0, customers: 0, monthlyRevenue: 0 },
    );

    return res.json({ agencies, totals });
  } catch (err) {
    console.error("List agencies error:", err.message);
    return res.status(500).json({ error: "Failed to list agencies" });
  }
}

/**
 * GET /api/agencies/settings
 * Returns the complete white-label configuration for the authenticated agency
 * owner's agency. 404 if the user does not own an agency.
 */
async function getAgencySettings(req, res) {
  try {
    const agency = await getOwnedAgency(req.user.userId);
    if (!agency) return res.status(404).json({ error: "No agency found for this account" });
    return res.json({ agency: serializeAgency(agency) });
  } catch (err) {
    console.error("Get agency settings error:", err.message);
    return res.status(500).json({ error: "Failed to load agency settings" });
  }
}

/**
 * PUT /api/agencies/settings
 * Updates the authenticated owner's white-label settings. Every field is
 * optional; only provided fields are changed.
 */
async function updateAgencySettings(req, res) {
  const {
    agencyName,
    logoUrl,
    primaryColor,
    secondaryColor,
    customDomain,
    supportEmail,
    isActive,
  } = req.body;

  if (agencyName !== undefined && !String(agencyName).trim()) {
    return res.status(400).json({ error: "agencyName cannot be empty" });
  }
  if (primaryColor !== undefined && primaryColor !== null && !isHexColor(primaryColor)) {
    return res.status(400).json({ error: "primaryColor must be a hex color (e.g. #2563eb)" });
  }
  if (secondaryColor !== undefined && secondaryColor !== null && !isHexColor(secondaryColor)) {
    return res.status(400).json({ error: "secondaryColor must be a hex color (e.g. #111827)" });
  }
  if (customDomain !== undefined && customDomain !== null && customDomain !== "" && !isValidDomain(customDomain)) {
    return res.status(400).json({ error: "customDomain must be a bare hostname (e.g. app.agency.com)" });
  }
  if (supportEmail !== undefined && supportEmail !== null && supportEmail !== "" && !isValidEmail(supportEmail)) {
    return res.status(400).json({ error: "supportEmail must be a valid email address" });
  }
  if (logoUrl !== undefined && logoUrl !== null && logoUrl !== "" && !isValidLogoUrl(logoUrl)) {
    return res.status(400).json({ error: "logoUrl must be a valid http(s) URL" });
  }

  try {
    const agency = await getOwnedAgency(req.user.userId);
    if (!agency) return res.status(404).json({ error: "No agency found for this account" });

    // Build a dynamic SET clause from only the provided fields.
    const sets = [];
    const values = [];
    let i = 1;
    const add = (col, val) => {
      sets.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (agencyName !== undefined) add("agency_name", String(agencyName).trim());
    if (logoUrl !== undefined) add("logo_url", logoUrl ? String(logoUrl).trim() : null);
    if (primaryColor !== undefined) add("primary_color", primaryColor || null);
    if (secondaryColor !== undefined) add("secondary_color", secondaryColor || null);
    if (customDomain !== undefined) {
      add("custom_domain", customDomain ? normalizeDomain(customDomain) : null);
    }
    if (supportEmail !== undefined) add("support_email", supportEmail ? String(supportEmail).trim() : null);
    if (isActive !== undefined) add("is_active", Boolean(isActive));

    if (!sets.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(agency.agency_id);
    await db.query(
      `UPDATE agencies SET ${sets.join(", ")} WHERE agency_id = $${i}`,
      values,
    );

    const updated = await getOwnedAgency(req.user.userId);
    return res.json({ agency: serializeAgency(updated) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That custom domain is already in use." });
    }
    console.error("Update agency settings error:", err.message);
    return res.status(500).json({ error: "Failed to update agency settings" });
  }
}

/**
 * POST /api/agencies/customers
 * Links an existing customer account (by email) to the authenticated owner's
 * agency, recording the monthly price charged. A customer can belong to only
 * one agency.
 */
async function addCustomer(req, res) {
  const { customerEmail, monthlyPrice } = req.body;

  if (!customerEmail || !String(customerEmail).trim()) {
    return res.status(400).json({ error: "customerEmail is required" });
  }
  const price = Number(monthlyPrice);
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "monthlyPrice must be a number >= 0" });
  }

  try {
    const agency = await getOwnedAgency(req.user.userId);
    if (!agency) return res.status(404).json({ error: "No agency found for this account" });

    const { rows: users } = await db.query(
      `SELECT user_id, email FROM users WHERE LOWER(email) = LOWER($1)`,
      [String(customerEmail).trim()],
    );
    if (!users.length) {
      return res.status(404).json({ error: "No user found with that email" });
    }
    const customer = users[0];

    const { rows } = await db.query(
      `INSERT INTO agency_customers (agency_id, customer_user_id, monthly_price)
       VALUES ($1, $2, $3)
       RETURNING agency_customer_id, monthly_price, created_at`,
      [agency.agency_id, customer.user_id, price],
    );

    return res.status(201).json({
      customer: {
        agencyCustomerId: rows[0].agency_customer_id,
        customerUserId: customer.user_id,
        email: customer.email,
        monthlyPrice: Number(rows[0].monthly_price),
        createdAt: rows[0].created_at,
      },
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That customer is already assigned to an agency." });
    }
    console.error("Add agency customer error:", err.message);
    return res.status(500).json({ error: "Failed to add customer" });
  }
}

/**
 * GET /api/agencies/customers
 * Lists the customers linked to the authenticated owner's agency.
 */
async function getAgencyCustomers(req, res) {
  try {
    const agency = await getOwnedAgency(req.user.userId);
    if (!agency) return res.status(404).json({ error: "No agency found for this account" });

    const { rows } = await db.query(
      `SELECT ac.agency_customer_id, ac.customer_user_id, u.email,
              ac.monthly_price, ac.created_at
       FROM agency_customers ac
       JOIN users u ON u.user_id = ac.customer_user_id
       WHERE ac.agency_id = $1
       ORDER BY ac.created_at DESC`,
      [agency.agency_id],
    );

    const customers = rows.map((r) => ({
      agencyCustomerId: r.agency_customer_id,
      customerUserId: r.customer_user_id,
      email: r.email,
      monthlyPrice: Number(r.monthly_price),
      createdAt: r.created_at,
    }));
    return res.json({ customers });
  } catch (err) {
    console.error("List agency customers error:", err.message);
    return res.status(500).json({ error: "Failed to load customers" });
  }
}

/**
 * GET /api/agencies/revenue
 * Monthly revenue report for the authenticated owner's agency.
 */
async function getRevenueReport(req, res) {
  try {
    const agency = await getOwnedAgency(req.user.userId);
    if (!agency) return res.status(404).json({ error: "No agency found for this account" });

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS customer_count,
              COALESCE(SUM(monthly_price), 0)::float AS monthly_revenue
       FROM agency_customers
       WHERE agency_id = $1`,
      [agency.agency_id],
    );

    const customerCount = rows[0].customer_count;
    const monthlyRevenue = rows[0].monthly_revenue;
    return res.json({
      report: {
        customerCount,
        monthlyRevenue,
        annualRevenue: monthlyRevenue * 12,
      },
    });
  } catch (err) {
    console.error("Revenue report error:", err.message);
    return res.status(500).json({ error: "Failed to load revenue report" });
  }
}

/**
 * GET /api/agencies/branding  (public)
 * Returns the branding for the agency matching the request's domain (attached
 * by the white-label middleware), or the default Zorecho branding when the
 * domain does not map to an active agency. Used by the client to theme itself.
 */
function getBranding(req, res) {
  const branding = req.agencyBranding
    ? { ...DEFAULT_BRANDING, ...req.agencyBranding }
    : { ...DEFAULT_BRANDING };
  return res.json({ branding });
}

module.exports = {
  createAgency,
  listAllAgencies,
  getAgencySettings,
  updateAgencySettings,
  addCustomer,
  getAgencyCustomers,
  getRevenueReport,
  getBranding,
};
