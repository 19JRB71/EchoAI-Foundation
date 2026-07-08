const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const supporterController = require("../controllers/supporterController");

// Voter CRM — available on every tier for political-campaign brands.
// Auth + lockout only; ownership is enforced per-brand in the controller.
router.use(auth, lockout);

// Campaign events (declared before the generic :supporterId routes).
router.get("/:brandId/events", supporterController.listEvents);
router.post("/:brandId/events", supporterController.createEvent);
router.put("/:brandId/events/:eventId", supporterController.updateEvent);
router.delete("/:brandId/events/:eventId", supporterController.deleteEvent);

// Supporters CRUD.
router.get("/:brandId", supporterController.listSupporters);
router.post("/:brandId", supporterController.createSupporter);
router.put("/:brandId/:supporterId", supporterController.updateSupporter);
router.delete("/:brandId/:supporterId", supporterController.deleteSupporter);

module.exports = router;
