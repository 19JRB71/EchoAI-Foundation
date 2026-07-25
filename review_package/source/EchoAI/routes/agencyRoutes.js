const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const admin = require("../middleware/admin");
const whiteLabel = require("../middleware/whiteLabel");
const whiteLabelController = require("../controllers/whiteLabelController");

// Public branding lookup — the client calls this on load to theme itself based
// on the domain it is served from. No auth (the login page needs it too); the
// white-label middleware resolves the domain to an agency's branding.
router.get("/branding", whiteLabel, whiteLabelController.getBranding);

// Everything below requires a valid session and an active (non-locked) account.
router.use(auth, lockout, featureGate("white_label"));

// Agency-owner self-service (the Agency Portal).
router.get("/settings", whiteLabelController.getAgencySettings);
router.put("/settings", whiteLabelController.updateAgencySettings);
router.post("/customers", whiteLabelController.addCustomer);
router.get("/customers", whiteLabelController.getAgencyCustomers);
router.get("/revenue", whiteLabelController.getRevenueReport);

// Platform-owner (admin) management — creating agencies and the all-agencies
// overview additionally require the admin role.
router.post("/", admin, whiteLabelController.createAgency);
router.get("/all", admin, whiteLabelController.listAllAgencies);

module.exports = router;
