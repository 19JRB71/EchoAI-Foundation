/**
 * Guided setup status routes.
 *
 * GET /api/setup/status/:brandId — the full per-feature setup checklist for
 * one owned brand. Read-only; powers the client's Setup Guide banners and the
 * overall setup progress card.
 */
const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { computeSetupStatus } = require("../utils/setupStatus");

const router = express.Router();

router.use(auth, lockout);

router.get("/status/:brandId", async (req, res) => {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const { rows } = await db.query(
      "SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2",
      [brandId, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const status = await computeSetupStatus(userId, brandId);
    res.json(status);
  } catch (err) {
    console.error("setup status error:", err.message);
    res.status(500).json({ error: "Could not load setup status" });
  }
});

module.exports = router;
