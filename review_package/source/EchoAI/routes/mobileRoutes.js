/**
 * Mobile data routes — mounted at /api/v2.
 *
 * Lean, cursor-paginated read endpoints for the native app's core screens. All
 * routes require a valid (mobile) access token AND an active subscription —
 * locked/past-due accounts get 403 (same lockout invariant as the web data
 * routes; only auth-recovery + push-management routes bypass lockout).
 */

const express = require("express");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const mobileController = require("../controllers/mobileController");

const router = express.Router();

router.use(auth, lockout, featureGate("mobile_api"));

router.get("/dashboard/:brandId", mobileController.getDashboard);
router.get("/leads", mobileController.getLeads);

module.exports = router;
