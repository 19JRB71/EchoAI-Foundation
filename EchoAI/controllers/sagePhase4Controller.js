/**
 * Sage V2 Phase 4 — Offers registry, Business Constraints, Executive Memory.
 *
 * All endpoints are flag-gated (SAGE_V2_OFFERS / SAGE_V2_CONSTRAINTS /
 * SAGE_V2_EXEC_MEMORY, default OFF → they answer { enabled:false } and touch
 * nothing). Routes are owner-only (requireOwner in sageRoutes): offers carry
 * owner-private margin notes and constraints carry legal/cash-flow notes.
 * Ownership: every brand-scoped read/write goes through getOwnedBrand.
 *
 * Phase 4 deliberately ships NO offer-performance rollups (campaign_id is a
 * forward link only) and NO constraint enforcement (utils/constraintClamp.js
 * ships inert; enforcement lands in Phase 5 with its enforcement points).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { _resetCacheForTests: resetPhase4Cache } = require("../utils/sagePhase4Context");

const OFFER_TYPES = ["discount", "financing", "guarantee", "bundle", "lead_magnet", "urgency"];
const MEMORY_KINDS = [
  "operational_lesson",
  "seasonal_lesson",
  "vendor",
  "local_insight",
  "unwritten_rule",
  "owner_context",
];

async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId],
  );
  return rows[0] || null;
}

function asDate(value, field) {
  if (value == null || value === "") return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    const err = new Error(`${field} must be a YYYY-MM-DD date.`);
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function asNonNegInt(value, field) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    const err = new Error(`${field} must be a non-negative whole number.`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function asText(value, field, { required = false, max = 2000 } = {}) {
  if (value == null) {
    if (required) {
      const err = new Error(`${field} is required.`);
      err.statusCode = 400;
      throw err;
    }
    return null;
  }
  const s = String(value).trim();
  if (!s) {
    if (required) {
      const err = new Error(`${field} is required.`);
      err.statusCode = 400;
      throw err;
    }
    return null;
  }
  return s.slice(0, max);
}

async function requireEnabledBrand(req, res, flag) {
  if (!(await getSwitch(flag))) {
    res.json({ enabled: false });
    return null;
  }
  const brandId = req.query.brandId || req.body.brandId;
  if (!brandId) {
    res.status(400).json({ error: "brandId is required." });
    return null;
  }
  const brand = await getOwnedBrand(req.user.userId, brandId);
  if (!brand) {
    res.status(404).json({ error: "Brand not found." });
    return null;
  }
  return brand;
}

// --- Offers -----------------------------------------------------------------

exports.listOffers = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OFFERS");
    if (!brand) return;
    const { rows } = await db.query(
      `SELECT offer_id, name, offer_type, terms, margin_note, starts_at, ends_at,
              status, created_at, updated_at
         FROM sage_offers
        WHERE brand_id = $1
        ORDER BY (status = 'active') DESC, created_at DESC`,
      [brand.brand_id],
    );
    res.json({ enabled: true, offers: rows });
  } catch (err) {
    next(err);
  }
};

exports.createOffer = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OFFERS");
    if (!brand) return;
    const name = asText(req.body.name, "name", { required: true, max: 200 });
    const offerType = String(req.body.offerType || "").trim();
    if (!OFFER_TYPES.includes(offerType)) {
      return res.status(400).json({ error: `offerType must be one of: ${OFFER_TYPES.join(", ")}.` });
    }
    const terms = asText(req.body.terms, "terms");
    const marginNote = asText(req.body.marginNote, "marginNote");
    const startsAt = asDate(req.body.startsAt, "startsAt");
    const endsAt = asDate(req.body.endsAt, "endsAt");
    if (startsAt && endsAt && endsAt < startsAt) {
      return res.status(400).json({ error: "endsAt must be on or after startsAt." });
    }
    const { rows } = await db.query(
      `INSERT INTO sage_offers (brand_id, name, offer_type, terms, margin_note, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING offer_id, name, offer_type, terms, margin_note, starts_at, ends_at, status, created_at, updated_at`,
      [brand.brand_id, name, offerType, terms, marginNote, startsAt, endsAt],
    );
    resetPhase4Cache();
    res.status(201).json({ enabled: true, offer: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateOffer = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OFFERS");
    if (!brand) return;
    const sets = [];
    const params = [req.params.id, brand.brand_id];
    const add = (col, value) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (req.body.name !== undefined) add("name", asText(req.body.name, "name", { required: true, max: 200 }));
    if (req.body.offerType !== undefined) {
      const t = String(req.body.offerType || "").trim();
      if (!OFFER_TYPES.includes(t)) {
        return res.status(400).json({ error: `offerType must be one of: ${OFFER_TYPES.join(", ")}.` });
      }
      add("offer_type", t);
    }
    if (req.body.terms !== undefined) add("terms", asText(req.body.terms, "terms"));
    if (req.body.marginNote !== undefined) add("margin_note", asText(req.body.marginNote, "marginNote"));
    if (req.body.startsAt !== undefined) add("starts_at", asDate(req.body.startsAt, "startsAt"));
    if (req.body.endsAt !== undefined) add("ends_at", asDate(req.body.endsAt, "endsAt"));
    if (req.body.status !== undefined) {
      const s = String(req.body.status || "").trim();
      if (!["active", "archived"].includes(s)) {
        return res.status(400).json({ error: "status must be 'active' or 'archived'." });
      }
      add("status", s);
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    const { rows } = await db.query(
      `UPDATE sage_offers SET ${sets.join(", ")}
        WHERE offer_id = $1 AND brand_id = $2
        RETURNING offer_id, name, offer_type, terms, margin_note, starts_at, ends_at, status, created_at, updated_at`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: "Offer not found." });
    resetPhase4Cache();
    res.json({ enabled: true, offer: rows[0] });
  } catch (err) {
    if (err && err.code === "23514") {
      return res.status(400).json({ error: "endsAt must be on or after startsAt." });
    }
    next(err);
  }
};

// --- Constraints --------------------------------------------------------------

exports.getConstraints = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_CONSTRAINTS");
    if (!brand) return;
    const { rows } = await db.query(
      `SELECT monthly_budget_cents, staff_count, weekly_capacity, blackout_dates,
              legal_notes, cash_flow_note, updated_at
         FROM brand_constraints WHERE brand_id = $1`,
      [brand.brand_id],
    );
    res.json({ enabled: true, constraints: rows[0] || null });
  } catch (err) {
    next(err);
  }
};

/**
 * Full-object upsert: the client sends every field; empty/null means "the
 * owner has not provided this" and stores NULL — never a fabricated default.
 */
exports.saveConstraints = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_CONSTRAINTS");
    if (!brand) return;
    let budgetCents = null;
    if (req.body.monthlyBudgetDollars != null && req.body.monthlyBudgetDollars !== "") {
      const d = Number(req.body.monthlyBudgetDollars);
      if (!Number.isFinite(d) || d < 0) {
        return res.status(400).json({ error: "monthlyBudgetDollars must be a non-negative number." });
      }
      budgetCents = Math.round(d * 100);
    }
    const staffCount = asNonNegInt(req.body.staffCount, "staffCount");
    const weeklyCapacity = asNonNegInt(req.body.weeklyCapacity, "weeklyCapacity");
    let blackoutDates = [];
    if (req.body.blackoutDates != null) {
      if (!Array.isArray(req.body.blackoutDates)) {
        return res.status(400).json({ error: "blackoutDates must be an array." });
      }
      blackoutDates = req.body.blackoutDates.map((b, i) => {
        if (!b || typeof b !== "object") {
          const err = new Error(`blackoutDates[${i}] must be an object.`);
          err.statusCode = 400;
          throw err;
        }
        const from = asDate(b.from, `blackoutDates[${i}].from`);
        const to = asDate(b.to, `blackoutDates[${i}].to`);
        if (!from && !to) {
          const err = new Error(`blackoutDates[${i}] needs a from and/or to date.`);
          err.statusCode = 400;
          throw err;
        }
        if (from && to && to < from) {
          const err = new Error(`blackoutDates[${i}]: to must be on or after from.`);
          err.statusCode = 400;
          throw err;
        }
        return { from, to, label: asText(b.label, "label", { max: 120 }) };
      });
    }
    const legalNotes = asText(req.body.legalNotes, "legalNotes");
    const cashFlowNote = asText(req.body.cashFlowNote, "cashFlowNote");
    const { rows } = await db.query(
      `INSERT INTO brand_constraints
         (brand_id, monthly_budget_cents, staff_count, weekly_capacity, blackout_dates, legal_notes, cash_flow_note)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (brand_id) DO UPDATE SET
         monthly_budget_cents = $2, staff_count = $3, weekly_capacity = $4,
         blackout_dates = $5::jsonb, legal_notes = $6, cash_flow_note = $7
       RETURNING monthly_budget_cents, staff_count, weekly_capacity, blackout_dates,
                 legal_notes, cash_flow_note, updated_at`,
      [
        brand.brand_id,
        budgetCents,
        staffCount,
        weeklyCapacity,
        JSON.stringify(blackoutDates),
        legalNotes,
        cashFlowNote,
      ],
    );
    resetPhase4Cache();
    res.json({ enabled: true, constraints: rows[0] });
  } catch (err) {
    next(err);
  }
};

// --- Executive Memory ----------------------------------------------------------

exports.listMemories = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_EXEC_MEMORY");
    if (!brand) return;
    const { rows } = await db.query(
      `SELECT memory_id, kind, content, source, confidence, status, created_at
         FROM sage_memory
        WHERE brand_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 200`,
      [brand.brand_id],
    );
    res.json({ enabled: true, memories: rows });
  } catch (err) {
    next(err);
  }
};

exports.createMemory = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_EXEC_MEMORY");
    if (!brand) return;
    const kind = String(req.body.kind || "").trim();
    if (!MEMORY_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${MEMORY_KINDS.join(", ")}.` });
    }
    const content = asText(req.body.content, "content", { required: true, max: 1000 });
    const { rows } = await db.query(
      `INSERT INTO sage_memory (brand_id, kind, content, source)
       VALUES ($1, $2, $3, 'owner_chat')
       RETURNING memory_id, kind, content, source, confidence, status, created_at`,
      [brand.brand_id, kind, content],
    );
    resetPhase4Cache();
    res.status(201).json({ enabled: true, memory: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.archiveMemory = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_EXEC_MEMORY");
    if (!brand) return;
    const { rowCount } = await db.query(
      `UPDATE sage_memory SET status = 'archived'
        WHERE memory_id = $1 AND brand_id = $2 AND status = 'active'`,
      [req.params.id, brand.brand_id],
    );
    if (!rowCount) return res.status(404).json({ error: "Memory not found." });
    resetPhase4Cache();
    res.json({ enabled: true, archived: true });
  } catch (err) {
    next(err);
  }
};

/**
 * Internal write path for Echo's confirmation-gated [[REMEMBER]] capture
 * (echoCompanionController). Validates ownership + kind, writes, returns the
 * row. Throws on any failure — the caller only appends its spoken "noted"
 * confirmation when this really succeeded.
 */
async function captureMemoryFromEcho(userId, brandId, kind, content, source) {
  if (!(await getSwitch("SAGE_V2_EXEC_MEMORY"))) {
    throw new Error("Executive memory is not enabled.");
  }
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) throw new Error("Brand not found for memory capture.");
  const cleanKind = MEMORY_KINDS.includes(kind) ? kind : "owner_context";
  const cleanContent = String(content || "").trim().slice(0, 1000);
  if (!cleanContent) throw new Error("Empty memory content.");
  const { rows } = await db.query(
    `INSERT INTO sage_memory (brand_id, kind, content, source)
     VALUES ($1, $2, $3, $4)
     RETURNING memory_id, kind, content`,
    [brand.brand_id, cleanKind, cleanContent, source === "owner_voice" ? "owner_voice" : "owner_chat"],
  );
  resetPhase4Cache();
  return rows[0];
}

exports.captureMemoryFromEcho = captureMemoryFromEcho;
exports.OFFER_TYPES = OFFER_TYPES;
exports.MEMORY_KINDS = MEMORY_KINDS;
