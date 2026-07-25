const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const {
  denyReadOnlyMutations,
  denySalesRep,
} = require("../middleware/rolePermissions");
const leadController = require("../controllers/leadController");
const chatbotController = require("../controllers/chatbotController");

// Public chatbot route — prospects are not logged-in users, so no auth/lockout.
router.post("/chat", chatbotController.chat);

// All remaining lead routes require authentication and an active subscription.
// Managers/viewers may READ leads/CRM but not create/convert/modify them.
// Sales reps are blocked entirely — they only ever work their masked CRM queue
// (see /api/crm), never the full lead list or raw contact numbers.
router.use(auth, lockout, denySalesRep, denyReadOnlyMutations);

router.post("/", leadController.createLead);
router.get("/", leadController.getLeads);
// Static path must be registered before "/:leadId" or it would be captured.
router.get("/outcome-coverage", leadController.getOutcomeCoverage);
router.get("/:leadId", leadController.getLeadProfile);
router.put("/:leadId", leadController.updateLead);
router.post("/:leadId/convert", leadController.convertLead);
router.post("/:leadId/outcome", leadController.recordLeadOutcome);

module.exports = router;
