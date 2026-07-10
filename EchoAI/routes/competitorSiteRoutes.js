/**
 * Competitor Website Analysis routes (Scout, Enterprise).
 *
 * Every route requires an authenticated, non-locked account on the Enterprise
 * tier (admin bypasses via featureGate) — matching Scout's Competitor Ad Spy.
 * Brand-scoped resources are guarded in the controller via getOwnedBrand
 * (brand.user_id). Order is auth → lockout → featureGate.
 */

const express = require("express");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const controller = require("../controllers/competitorSiteController");

const router = express.Router();

router.use(auth, lockout, featureGate("competitor_sites"));

router.get("/:brandId/sites", controller.listSites);
router.post("/:brandId/sites", controller.addSite);
router.delete("/:brandId/sites/:siteId", controller.removeSite);
router.post("/:brandId/sites/:siteId/recheck", controller.recheckSite);

module.exports = router;
