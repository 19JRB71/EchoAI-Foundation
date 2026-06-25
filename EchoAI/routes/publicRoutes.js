const express = require("express");

const publicController = require("../controllers/publicController");

const router = express.Router();

// All routes here are PUBLIC — prospects clicking a Facebook ad are not logged in.

// Safe, public-facing brand profile for the voice landing page header.
router.get("/brand/:brandId", publicController.getPublicBrandProfile);

// Start a brand-linked lead conversation and capture contact details later.
router.post("/lead/start", publicController.startLeadConversation);
router.post("/lead/:leadId/contact", publicController.saveLeadContact);

module.exports = router;
