/**
 * Voter CRM — supporters + campaign events for political-campaign brands.
 *
 * Supporters are every voter, donor, and volunteer contact a campaign is
 * tracking (with follow-up status and optional donation totals). Campaign
 * events carry attendance numbers that feed the event-attendance goal metric.
 * All routes are brand-scoped and ownership-guarded via getOwnedBrand.
 */

const db = require("../config/db");

const SUPPORTER_TYPES = ["voter", "donor", "volunteer"];
const SUPPORTER_STATUSES = ["new", "contacted", "engaged", "committed"];

async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT brand_id, brand_name, brand_type FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId]
  );
  if (rows.length === 0) {
    const err = new Error("Brand not found");
    err.statusCode = 404;
    throw err;
  }
  // The Voter CRM only exists for political-campaign brands — enforce it
  // server-side too, not just in the client nav.
  if (rows[0].brand_type !== "political") {
    const err = new Error("The Voter CRM is only available for political campaign brands");
    err.statusCode = 403;
    throw err;
  }
  return rows[0];
}

function parseSupporterType(v) {
  if (v == null || v === "") return "voter";
  if (!SUPPORTER_TYPES.includes(v)) {
    const err = new Error(`supporterType must be one of: ${SUPPORTER_TYPES.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}

function parseStatus(v) {
  if (v == null || v === "") return "new";
  if (!SUPPORTER_STATUSES.includes(v)) {
    const err = new Error(`status must be one of: ${SUPPORTER_STATUSES.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}

function statusFor(err) {
  return err && err.statusCode ? err.statusCode : 500;
}

function cleanStr(v, max = 255) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function parseDonation(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("donationAmount must be a non-negative number");
    err.statusCode = 400;
    throw err;
  }
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Supporters
// ---------------------------------------------------------------------------

// GET /api/supporters/:brandId?type=&status=&search=
async function listSupporters(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { type, status, search } = req.query;
    const where = ["brand_id = $1"];
    const params = [brand.brand_id];
    if (type && SUPPORTER_TYPES.includes(type)) {
      params.push(type);
      where.push(`supporter_type = $${params.length}`);
    }
    if (status && SUPPORTER_STATUSES.includes(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (typeof search === "string" && search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(
        `(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`
      );
    }
    const { rows } = await db.query(
      `SELECT * FROM supporters WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC LIMIT 500`,
      params
    );
    const totals = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE supporter_type = 'voter')::int AS voters,
              COUNT(*) FILTER (WHERE supporter_type = 'donor')::int AS donors,
              COUNT(*) FILTER (WHERE supporter_type = 'volunteer')::int AS volunteers,
              COALESCE(SUM(donation_amount), 0)::float AS donations_total
         FROM supporters WHERE brand_id = $1`,
      [brand.brand_id]
    );
    return res.json({ supporters: rows, summary: totals.rows[0] });
  } catch (err) {
    console.error("List supporters error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load supporters" });
  }
}

// POST /api/supporters/:brandId
async function createSupporter(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const name = cleanStr(req.body.name, 200);
    if (!name) return res.status(400).json({ error: "A name is required" });
    const supporterType = parseSupporterType(req.body.supporterType);
    const status = parseStatus(req.body.status);
    const donation = parseDonation(req.body.donationAmount);
    const { rows } = await db.query(
      `INSERT INTO supporters
         (brand_id, name, email, phone, supporter_type, donation_amount, notes, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        brand.brand_id,
        name,
        cleanStr(req.body.email),
        cleanStr(req.body.phone, 40),
        supporterType,
        donation,
        cleanStr(req.body.notes, 5000),
        status,
        cleanStr(req.body.source, 60) || "manual",
      ]
    );
    return res.status(201).json({ supporter: rows[0] });
  } catch (err) {
    console.error("Create supporter error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to add supporter" });
  }
}

// PUT /api/supporters/:brandId/:supporterId
async function updateSupporter(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const name = cleanStr(req.body.name, 200);
    if (!name) return res.status(400).json({ error: "A name is required" });
    const supporterType = parseSupporterType(req.body.supporterType);
    const status = parseStatus(req.body.status);
    const donation = parseDonation(req.body.donationAmount);
    const { rows } = await db.query(
      `UPDATE supporters
          SET name = $1, email = $2, phone = $3, supporter_type = $4,
              donation_amount = $5, notes = $6, status = $7, updated_at = NOW()
        WHERE supporter_id = $8 AND brand_id = $9
        RETURNING *`,
      [
        name,
        cleanStr(req.body.email),
        cleanStr(req.body.phone, 40),
        supporterType,
        donation,
        cleanStr(req.body.notes, 5000),
        status,
        req.params.supporterId,
        brand.brand_id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Supporter not found" });
    return res.json({ supporter: rows[0] });
  } catch (err) {
    console.error("Update supporter error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to update supporter" });
  }
}

// DELETE /api/supporters/:brandId/:supporterId
async function deleteSupporter(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rowCount } = await db.query(
      "DELETE FROM supporters WHERE supporter_id = $1 AND brand_id = $2",
      [req.params.supporterId, brand.brand_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Supporter not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete supporter error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to delete supporter" });
  }
}

// ---------------------------------------------------------------------------
// Campaign events
// ---------------------------------------------------------------------------

// GET /api/supporters/:brandId/events
async function listEvents(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rows } = await db.query(
      `SELECT * FROM campaign_events WHERE brand_id = $1
        ORDER BY event_date DESC LIMIT 200`,
      [brand.brand_id]
    );
    return res.json({ events: rows });
  } catch (err) {
    console.error("List campaign events error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load events" });
  }
}

function parseEventBody(body) {
  const eventName = cleanStr(body.eventName, 200);
  if (!eventName) {
    const err = new Error("An event name is required");
    err.statusCode = 400;
    throw err;
  }
  const eventDate = cleanStr(body.eventDate, 20);
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    const err = new Error("eventDate must be a date in YYYY-MM-DD format");
    err.statusCode = 400;
    throw err;
  }
  // Reject impossible calendar dates (e.g. 2026-02-30) before they become a
  // Postgres cast error (500).
  const parsed = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== eventDate) {
    const err = new Error("eventDate is not a real calendar date");
    err.statusCode = 400;
    throw err;
  }
  let attendance = null;
  if (body.attendance != null && body.attendance !== "") {
    const n = Number(body.attendance);
    if (!Number.isInteger(n) || n < 0) {
      const err = new Error("attendance must be a non-negative whole number");
      err.statusCode = 400;
      throw err;
    }
    attendance = n;
  }
  return {
    eventName,
    eventDate,
    location: cleanStr(body.location, 200),
    attendance,
    notes: cleanStr(body.notes, 5000),
  };
}

// POST /api/supporters/:brandId/events
async function createEvent(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const ev = parseEventBody(req.body);
    const { rows } = await db.query(
      `INSERT INTO campaign_events (brand_id, event_name, event_date, location, attendance, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [brand.brand_id, ev.eventName, ev.eventDate, ev.location, ev.attendance, ev.notes]
    );
    return res.status(201).json({ event: rows[0] });
  } catch (err) {
    console.error("Create campaign event error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to add event" });
  }
}

// PUT /api/supporters/:brandId/events/:eventId
async function updateEvent(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const ev = parseEventBody(req.body);
    const { rows } = await db.query(
      `UPDATE campaign_events
          SET event_name = $1, event_date = $2, location = $3, attendance = $4,
              notes = $5, updated_at = NOW()
        WHERE event_id = $6 AND brand_id = $7
        RETURNING *`,
      [ev.eventName, ev.eventDate, ev.location, ev.attendance, ev.notes, req.params.eventId, brand.brand_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Event not found" });
    return res.json({ event: rows[0] });
  } catch (err) {
    console.error("Update campaign event error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to update event" });
  }
}

// DELETE /api/supporters/:brandId/events/:eventId
async function deleteEvent(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rowCount } = await db.query(
      "DELETE FROM campaign_events WHERE event_id = $1 AND brand_id = $2",
      [req.params.eventId, brand.brand_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Event not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete campaign event error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to delete event" });
  }
}

module.exports = {
  SUPPORTER_TYPES,
  SUPPORTER_STATUSES,
  listSupporters,
  createSupporter,
  updateSupporter,
  deleteSupporter,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
};
