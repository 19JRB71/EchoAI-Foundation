const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const admin = require("../middleware/admin");
const affiliateController = require("../controllers/affiliateController");

// Public: store a visitor's referral code in a cookie so a later signup is
// attributed to the affiliate. No auth — visitors aren't logged in yet.
router.post("/track/:code", affiliateController.trackReferral);

// Everything below requires a valid session and an active (non-locked) account.
router.use(auth, lockout, featureGate("affiliate"));

// Affiliate self-service. Anyone can join the program and manage their own
// referrals/payouts.
router.post("/register", affiliateController.registerAffiliate);
router.get("/profile", affiliateController.getAffiliateProfile);
router.get("/commissions", affiliateController.getCommissions);
router.post("/payout", affiliateController.requestPayout);

// Platform-owner (admin) management — overview + advancing the commission
// lifecycle + suspending affiliates.
router.get("/all", admin, affiliateController.adminListAffiliates);
router.post("/approve", admin, affiliateController.adminUpdateCommissions);
router.post("/suspend", admin, affiliateController.adminSetAffiliateStatus);

module.exports = router;
