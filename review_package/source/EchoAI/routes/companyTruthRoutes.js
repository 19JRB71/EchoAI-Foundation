/**
 * Company Truth routes — Sage's approved Company Intelligence Report.
 * All tiers (this is the platform's honesty backbone, not an upsell).
 * auth + lockout; every handler re-verifies brand ownership.
 */

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const controller = require("../controllers/companyTruthController");

router.use(auth, lockout);

router.get("/", controller.getState);
router.post("/generate", controller.generate);
router.post("/approve", controller.approve);
router.patch("/report", controller.editSection);
router.post("/research", controller.requestResearch);

module.exports = router;
