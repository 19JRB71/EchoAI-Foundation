/**
 * Competitor Ad Spy routes (Enterprise) — Scout's competitive ad intelligence.
 *
 * Every route requires an authenticated, non-locked account on the Enterprise
 * tier (admin bypasses via featureGate). Brand-scoped resources are guarded in
 * the controller via getOwnedBrand (brand.user_id). Order is auth → lockout →
 * featureGate, matching every other gated data route.
 */

const express = require("express");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const controller = require("../controllers/competitorAdSpyController");

const router = express.Router();

router.use(auth, lockout, featureGate("competitor_ad_spy"));

// Live feed (grouped by competitor) + latest weekly report
router.get("/:brandId/feed", controller.getFeed);
router.post("/:brandId/scan", controller.scan);

// Weekly ad intelligence report
router.get("/:brandId/report", controller.getReport);
router.post("/:brandId/report/generate", controller.generateReport);

// Draft a counter campaign against one competitor ad
router.post("/:brandId/ads/:adId/counter", controller.draftCounter);

module.exports = router;
