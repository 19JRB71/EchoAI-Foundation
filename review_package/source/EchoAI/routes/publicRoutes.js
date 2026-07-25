const express = require("express");

const publicController = require("../controllers/publicController");
const healthMonitorController = require("../controllers/healthMonitorController");

const router = express.Router();

// All routes here are PUBLIC — prospects clicking a Facebook ad are not logged in.

// Safe, public-facing brand profile for the voice landing page header.
router.get("/brand/:brandId", publicController.getPublicBrandProfile);

// Start a brand-linked lead conversation and capture contact details later.
router.post("/lead/start", publicController.startLeadConversation);
router.post("/lead/:leadId/contact", publicController.saveLeadContact);

// Public screenshot support — the Help widget on the login screen lets a user
// who can't log in send a screenshot + description to the AI support agent.
// Larger JSON limit (base64 screenshot data URLs); the global parser skips this
// exact path so this scoped parser handles the body.
router.post(
  "/support",
  express.json({ limit: "12mb" }),
  healthMonitorController.submitPublicSupportTicket,
);

module.exports = router;
