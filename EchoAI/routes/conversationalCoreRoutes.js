// ---------------------------------------------------------------------------
// Zorecho Conversational Core Lab — EXPERIMENTAL PROTOTYPE routes.
//
// Owner/admin-only. Everything except /status is gated on the
// ENABLE_CONVERSATIONAL_CORE feature flag (off by default) plus the in-memory
// emergency-disable switch — when off, /converse answers 503 and the normal
// Echo experience is untouched.
// ---------------------------------------------------------------------------

const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const core = require("../utils/conversationalCore");
const db = require("../config/db");

router.use(auth, lockout, requireOwner);

// Lab status — visible even when disabled so the Lab page can explain itself.
router.get("/status", (req, res) => {
  res.json(core.coreStatus());
});

// One-click emergency disable / re-enable (in-memory; flag still rules).
router.post("/emergency-disable", (req, res) => {
  core.setEmergencyDisabled(true);
  res.json({ ...core.coreStatus(), message: "Conversational Core disabled immediately." });
});

router.post("/re-enable", (req, res) => {
  core.setEmergencyDisabled(false);
  res.json(core.coreStatus());
});

// Flag gate for everything below.
router.use((req, res, next) => {
  if (!core.coreEnabled()) {
    return res.status(503).json({
      error: "The Conversational Core prototype is not enabled.",
      code: "core_disabled",
    });
  }
  next();
});

// Main conversation turn.
router.post("/converse", async (req, res, next) => {
  try {
    const { text, sessionId, brandId } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Say or type something first." });
    }

    // Resolve the brand name (ownership-checked) for prompt scoping.
    let brandName = null;
    let ownedBrandId = null;
    if (brandId) {
      const { rows } = await db.query(
        `SELECT brand_id, brand_name FROM brands WHERE brand_id = $1 AND user_id = $2`,
        [brandId, req.user.userId],
      );
      if (rows[0]) {
        ownedBrandId = rows[0].brand_id;
        brandName = rows[0].brand_name;
      }
    }

    const trace = await core.handleTurn({
      userId: req.user.userId,
      brandId: ownedBrandId,
      brandName,
      text: text.trim(),
      sessionId: sessionId || `user-${req.user.userId}`,
    });
    res.json({ trace });
  } catch (err) {
    next(err);
  }
});

// Flight recorder — recent sanitized traces (own traces only).
router.get("/recorder", (req, res) => {
  res.json({ traces: core.recentTraces(req.user.userId, 20) });
});

// End the test session (clears temporary session memory).
router.post("/session/end", (req, res) => {
  const { sessionId } = req.body || {};
  core.endSession(req.user.userId, sessionId || `user-${req.user.userId}`);
  res.json({ ended: true });
});

module.exports = router;
