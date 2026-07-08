/**
 * Property CRM — listings, buyer/seller leads, and open houses for
 * real-estate brands (brand_type = 'real_estate').
 *
 * Listings carry the honest inputs for the days-on-market and GCI goals
 * (listed_date / sold_date / gci_amount). Leads carry lead_kind
 * (buyer|seller), a readiness category, and first-contact / conversion
 * timestamps that power the lead-response-time and buyer-closings metrics.
 * Open houses carry per-phase automation markers (promoted / reminded /
 * followed up) consumed by the scheduler sweeps.
 *
 * All routes are brand-scoped and ownership-guarded via getOwnedBrand.
 */

const db = require("../config/db");

const LISTING_STATUSES = ["active", "pending", "sold", "withdrawn"];
const LEAD_KINDS = ["buyer", "seller"];
const LEAD_STATUSES = ["new", "contacted", "engaged", "converted"];
const LEAD_CATEGORIES = {
  buyer: ["actively_looking", "casually_browsing", "not_ready"],
  seller: ["ready_to_list", "thinking_about_it", "just_curious"],
};

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
  // The Property CRM only exists for real-estate brands — enforce it
  // server-side too, not just in the client nav.
  if (rows[0].brand_type !== "real_estate") {
    const err = new Error("The Property CRM is only available for real estate brands");
    err.statusCode = 403;
    throw err;
  }
  return rows[0];
}

function statusFor(err) {
  return err && err.statusCode ? err.statusCode : 500;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function cleanStr(v, max = 255) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function parseNumber(v, label, { integer = false } = {}) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    throw badRequest(`${label} must be a non-negative ${integer ? "whole " : ""}number`);
  }
  return integer ? n : Math.round(n * 100) / 100;
}

function parseDateStr(v, label, { required = false } = {}) {
  const s = cleanStr(v, 20);
  if (!s) {
    if (required) throw badRequest(`${label} is required (YYYY-MM-DD)`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`${label} must be a date in YYYY-MM-DD format`);
  const parsed = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) {
    throw badRequest(`${label} is not a real calendar date`);
  }
  return s;
}

function parseEnum(v, allowed, label, fallback) {
  if (v == null || v === "") return fallback;
  if (!allowed.includes(v)) throw badRequest(`${label} must be one of: ${allowed.join(", ")}`);
  return v;
}

function parsePhotoUrls(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw badRequest("photoUrls must be an array of URLs");
  const urls = v
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean)
    .slice(0, 30);
  for (const u of urls) {
    if (!/^https:\/\//i.test(u)) throw badRequest("Every photo URL must start with https://");
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

function parseListingBody(body) {
  const address = cleanStr(body.address, 300);
  if (!address) throw badRequest("An address is required");
  const status = parseEnum(body.status, LISTING_STATUSES, "status", "active");
  const soldDate = parseDateStr(body.soldDate, "soldDate");
  const gci = parseNumber(body.gciAmount, "gciAmount");
  if (status !== "sold" && (soldDate || gci != null)) {
    throw badRequest("soldDate and gciAmount can only be set when status is 'sold'");
  }
  if (status === "sold" && !soldDate) {
    throw badRequest("A soldDate (YYYY-MM-DD) is required when marking a listing sold");
  }
  return {
    address,
    city: cleanStr(body.city, 120),
    state: cleanStr(body.state, 60),
    zip: cleanStr(body.zip, 20),
    price: parseNumber(body.price, "price"),
    beds: parseNumber(body.beds, "beds", { integer: true }),
    baths: parseNumber(body.baths, "baths"),
    sqft: parseNumber(body.sqft, "sqft", { integer: true }),
    description: cleanStr(body.description, 10000),
    keyFeatures: cleanStr(body.keyFeatures, 5000),
    photoUrls: parsePhotoUrls(body.photoUrls),
    status,
    listedDate: parseDateStr(body.listedDate, "listedDate"),
    soldDate,
    gciAmount: gci,
    showingCount: parseNumber(body.showingCount, "showingCount", { integer: true }),
  };
}

// GET /api/properties/:brandId/listings?status=
async function listListings(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const where = ["brand_id = $1"];
    const params = [brand.brand_id];
    if (req.query.status && LISTING_STATUSES.includes(req.query.status)) {
      params.push(req.query.status);
      where.push(`status = $${params.length}`);
    }
    const { rows } = await db.query(
      `SELECT * FROM property_listings WHERE ${where.join(" AND ")}
        ORDER BY listed_date DESC, created_at DESC LIMIT 500`,
      params
    );
    const totals = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'sold')::int AS sold,
              COALESCE(SUM(gci_amount) FILTER (WHERE status = 'sold'), 0)::float AS gci_total
         FROM property_listings WHERE brand_id = $1`,
      [brand.brand_id]
    );
    return res.json({ listings: rows, summary: totals.rows[0] });
  } catch (err) {
    console.error("List property listings error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load listings" });
  }
}

// POST /api/properties/:brandId/listings
async function createListing(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const l = parseListingBody(req.body);
    const { rows } = await db.query(
      `INSERT INTO property_listings
         (brand_id, address, city, state, zip, price, beds, baths, sqft,
          description, key_features, photo_urls, status, listed_date, sold_date,
          gci_amount, showing_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,
               COALESCE($14::date, NOW()::date), $15, $16, COALESCE($17, 0))
       RETURNING *`,
      [
        brand.brand_id, l.address, l.city, l.state, l.zip, l.price, l.beds,
        l.baths, l.sqft, l.description, l.keyFeatures, JSON.stringify(l.photoUrls),
        l.status, l.listedDate, l.soldDate, l.gciAmount, l.showingCount,
      ]
    );
    return res.status(201).json({ listing: rows[0] });
  } catch (err) {
    console.error("Create property listing error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to add listing" });
  }
}

// PUT /api/properties/:brandId/listings/:listingId
async function updateListing(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const l = parseListingBody(req.body);
    const { rows } = await db.query(
      `UPDATE property_listings
          SET address = $1, city = $2, state = $3, zip = $4, price = $5,
              beds = $6, baths = $7, sqft = $8, description = $9,
              key_features = $10, photo_urls = $11::jsonb, status = $12,
              listed_date = COALESCE($13::date, listed_date),
              sold_date = $14, gci_amount = $15,
              showing_count = COALESCE($16, showing_count), updated_at = NOW()
        WHERE listing_id = $17 AND brand_id = $18
        RETURNING *`,
      [
        l.address, l.city, l.state, l.zip, l.price, l.beds, l.baths, l.sqft,
        l.description, l.keyFeatures, JSON.stringify(l.photoUrls), l.status,
        l.listedDate, l.soldDate, l.gciAmount, l.showingCount,
        req.params.listingId, brand.brand_id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Listing not found" });
    return res.json({ listing: rows[0] });
  } catch (err) {
    console.error("Update property listing error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to update listing" });
  }
}

// DELETE /api/properties/:brandId/listings/:listingId
async function deleteListing(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rowCount } = await db.query(
      "DELETE FROM property_listings WHERE listing_id = $1 AND brand_id = $2",
      [req.params.listingId, brand.brand_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Listing not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete property listing error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to delete listing" });
  }
}

// ---------------------------------------------------------------------------
// Buyer & seller leads
// ---------------------------------------------------------------------------

function parseLeadBody(body) {
  const name = cleanStr(body.name, 200);
  if (!name) throw badRequest("A name is required");
  const leadKind = parseEnum(body.leadKind, LEAD_KINDS, "leadKind", null);
  if (!leadKind) throw badRequest(`leadKind must be one of: ${LEAD_KINDS.join(", ")}`);
  const category = parseEnum(
    body.category,
    LEAD_CATEGORIES[leadKind],
    `category (for a ${leadKind} lead)`,
    null
  );
  const status = parseEnum(body.status, LEAD_STATUSES, "status", "new");
  return {
    name,
    leadKind,
    email: cleanStr(body.email),
    phone: cleanStr(body.phone, 40),
    budget: cleanStr(body.budget, 120),
    timeline: cleanStr(body.timeline, 120),
    mustHaves: cleanStr(body.mustHaves, 5000),
    motivation: cleanStr(body.motivation, 5000),
    currentHome: cleanStr(body.currentHome, 5000),
    category,
    status,
    source: cleanStr(body.source, 60) || "manual",
    notes: cleanStr(body.notes, 5000),
  };
}

// GET /api/properties/:brandId/leads?kind=&status=&search=
async function listLeads(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const where = ["brand_id = $1"];
    const params = [brand.brand_id];
    if (req.query.kind && LEAD_KINDS.includes(req.query.kind)) {
      params.push(req.query.kind);
      where.push(`lead_kind = $${params.length}`);
    }
    if (req.query.status && LEAD_STATUSES.includes(req.query.status)) {
      params.push(req.query.status);
      where.push(`status = $${params.length}`);
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      params.push(`%${req.query.search.trim()}%`);
      where.push(
        `(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`
      );
    }
    const { rows } = await db.query(
      `SELECT * FROM property_leads WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC LIMIT 500`,
      params
    );
    const totals = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE lead_kind = 'buyer')::int AS buyers,
              COUNT(*) FILTER (WHERE lead_kind = 'seller')::int AS sellers,
              COUNT(*) FILTER (WHERE status = 'converted')::int AS converted
         FROM property_leads WHERE brand_id = $1`,
      [brand.brand_id]
    );
    return res.json({ leads: rows, summary: totals.rows[0] });
  } catch (err) {
    console.error("List property leads error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load leads" });
  }
}

// POST /api/properties/:brandId/leads
async function createLead(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const l = parseLeadBody(req.body);
    const { rows } = await db.query(
      `INSERT INTO property_leads
         (brand_id, lead_kind, name, email, phone, budget, timeline, must_haves,
          motivation, current_home, category, status, source, notes,
          first_contact_at, converted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               CASE WHEN $12 IN ('contacted','engaged','converted') THEN NOW() END,
               CASE WHEN $12 = 'converted' THEN NOW() END)
       RETURNING *`,
      [
        brand.brand_id, l.leadKind, l.name, l.email, l.phone, l.budget,
        l.timeline, l.mustHaves, l.motivation, l.currentHome, l.category,
        l.status, l.source, l.notes,
      ]
    );
    return res.status(201).json({ lead: rows[0] });
  } catch (err) {
    console.error("Create property lead error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to add lead" });
  }
}

// PUT /api/properties/:brandId/leads/:leadId
// first_contact_at / converted_at are set once (honest metrics) — moving a
// lead forward stamps them, moving it back never erases them.
async function updateLead(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const l = parseLeadBody(req.body);
    const { rows } = await db.query(
      `UPDATE property_leads
          SET lead_kind = $1, name = $2, email = $3, phone = $4, budget = $5,
              timeline = $6, must_haves = $7, motivation = $8, current_home = $9,
              category = $10, status = $11, notes = $12,
              first_contact_at = COALESCE(first_contact_at,
                CASE WHEN $11 IN ('contacted','engaged','converted') THEN NOW() END),
              converted_at = COALESCE(converted_at,
                CASE WHEN $11 = 'converted' THEN NOW() END),
              updated_at = NOW()
        WHERE property_lead_id = $13 AND brand_id = $14
        RETURNING *`,
      [
        l.leadKind, l.name, l.email, l.phone, l.budget, l.timeline, l.mustHaves,
        l.motivation, l.currentHome, l.category, l.status, l.notes,
        req.params.leadId, brand.brand_id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Lead not found" });
    return res.json({ lead: rows[0] });
  } catch (err) {
    console.error("Update property lead error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to update lead" });
  }
}

// DELETE /api/properties/:brandId/leads/:leadId
async function deleteLead(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rowCount } = await db.query(
      "DELETE FROM property_leads WHERE property_lead_id = $1 AND brand_id = $2",
      [req.params.leadId, brand.brand_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Lead not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete property lead error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to delete lead" });
  }
}

// ---------------------------------------------------------------------------
// Open houses
// ---------------------------------------------------------------------------

async function parseOpenHouseBody(body, brandId) {
  const eventDate = parseDateStr(body.eventDate, "eventDate", { required: true });
  let listingId = cleanStr(body.listingId, 60);
  let address = cleanStr(body.address, 300);
  if (listingId) {
    const { rows } = await db.query(
      "SELECT listing_id, address FROM property_listings WHERE listing_id = $1 AND brand_id = $2",
      [listingId, brandId]
    );
    if (rows.length === 0) throw badRequest("listingId does not match one of this brand's listings");
    if (!address) address = rows[0].address;
  }
  if (!address) throw badRequest("An address is required (or pick one of your listings)");
  return {
    listingId: listingId || null,
    address,
    eventDate,
    startTime: cleanStr(body.startTime, 20),
    endTime: cleanStr(body.endTime, 20),
    notes: cleanStr(body.notes, 5000),
  };
}

// GET /api/properties/:brandId/open-houses
async function listOpenHouses(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rows } = await db.query(
      `SELECT oh.*,
              (SELECT COUNT(*)::int FROM open_house_attendees a
                WHERE a.open_house_id = oh.open_house_id) AS attendee_count,
              (SELECT COUNT(*)::int FROM open_house_attendees a
                WHERE a.open_house_id = oh.open_house_id AND a.interested) AS interested_count
         FROM open_houses oh
        WHERE oh.brand_id = $1
        ORDER BY oh.event_date DESC LIMIT 200`,
      [brand.brand_id]
    );
    return res.json({ openHouses: rows });
  } catch (err) {
    console.error("List open houses error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load open houses" });
  }
}

// POST /api/properties/:brandId/open-houses
async function createOpenHouse(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const oh = await parseOpenHouseBody(req.body, brand.brand_id);
    const { rows } = await db.query(
      `INSERT INTO open_houses (brand_id, listing_id, address, event_date, start_time, end_time, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [brand.brand_id, oh.listingId, oh.address, oh.eventDate, oh.startTime, oh.endTime, oh.notes]
    );
    return res.status(201).json({ openHouse: rows[0] });
  } catch (err) {
    console.error("Create open house error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to add open house" });
  }
}

// PUT /api/properties/:brandId/open-houses/:openHouseId
async function updateOpenHouse(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const oh = await parseOpenHouseBody(req.body, brand.brand_id);
    const { rows } = await db.query(
      `UPDATE open_houses
          SET listing_id = $1, address = $2, event_date = $3, start_time = $4,
              end_time = $5, notes = $6, updated_at = NOW()
        WHERE open_house_id = $7 AND brand_id = $8
        RETURNING *`,
      [oh.listingId, oh.address, oh.eventDate, oh.startTime, oh.endTime, oh.notes,
       req.params.openHouseId, brand.brand_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Open house not found" });
    return res.json({ openHouse: rows[0] });
  } catch (err) {
    console.error("Update open house error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to update open house" });
  }
}

// DELETE /api/properties/:brandId/open-houses/:openHouseId
async function deleteOpenHouse(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    const { rowCount } = await db.query(
      "DELETE FROM open_houses WHERE open_house_id = $1 AND brand_id = $2",
      [req.params.openHouseId, brand.brand_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Open house not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete open house error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to delete open house" });
  }
}

// --- attendees ---------------------------------------------------------------

async function getOwnedOpenHouse(brandId, openHouseId) {
  const { rows } = await db.query(
    "SELECT open_house_id FROM open_houses WHERE open_house_id = $1 AND brand_id = $2",
    [openHouseId, brandId]
  );
  if (rows.length === 0) {
    const err = new Error("Open house not found");
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// GET /api/properties/:brandId/open-houses/:openHouseId/attendees
async function listAttendees(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    await getOwnedOpenHouse(brand.brand_id, req.params.openHouseId);
    const { rows } = await db.query(
      `SELECT * FROM open_house_attendees WHERE open_house_id = $1
        ORDER BY created_at DESC LIMIT 500`,
      [req.params.openHouseId]
    );
    return res.json({ attendees: rows });
  } catch (err) {
    console.error("List open house attendees error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load attendees" });
  }
}

// POST /api/properties/:brandId/open-houses/:openHouseId/attendees
async function createAttendee(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    await getOwnedOpenHouse(brand.brand_id, req.params.openHouseId);
    const name = cleanStr(req.body.name, 200);
    if (!name) return res.status(400).json({ error: "A name is required" });
    const { rows } = await db.query(
      `INSERT INTO open_house_attendees (open_house_id, name, email, phone, interested, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.params.openHouseId, name, cleanStr(req.body.email),
        cleanStr(req.body.phone, 40), req.body.interested === true,
        cleanStr(req.body.notes, 5000),
      ]
    );
    return res.status(201).json({ attendee: rows[0] });
  } catch (err) {
    console.error("Create open house attendee error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to add attendee" });
  }
}

// DELETE /api/properties/:brandId/open-houses/:openHouseId/attendees/:attendeeId
async function deleteAttendee(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    await getOwnedOpenHouse(brand.brand_id, req.params.openHouseId);
    const { rowCount } = await db.query(
      "DELETE FROM open_house_attendees WHERE attendee_id = $1 AND open_house_id = $2",
      [req.params.attendeeId, req.params.openHouseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Attendee not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete open house attendee error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to delete attendee" });
  }
}

module.exports = {
  LISTING_STATUSES,
  LEAD_KINDS,
  LEAD_STATUSES,
  LEAD_CATEGORIES,
  listListings,
  createListing,
  updateListing,
  deleteListing,
  listLeads,
  createLead,
  updateLead,
  deleteLead,
  listOpenHouses,
  createOpenHouse,
  updateOpenHouse,
  deleteOpenHouse,
  listAttendees,
  createAttendee,
  deleteAttendee,
};
