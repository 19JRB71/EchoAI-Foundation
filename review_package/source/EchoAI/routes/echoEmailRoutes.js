const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const controller = require("../controllers/echoEmailController");

// The email assistant reads the OWNER's personal inbox — owner-only, always.
router.use(auth, lockout, requireOwner);

// Accounts
router.get("/accounts", controller.listAccounts);
router.post("/accounts", controller.connectAccount);
router.delete("/accounts/:id", controller.removeAccount);
router.post("/check-now", controller.checkNow);

// Inbox intelligence
router.get("/summary", controller.inboxSummary);
router.get("/messages", controller.listMessages);

// Drafts (AI draft → approve/send or discard; nothing sends without approval)
router.get("/drafts", controller.listDrafts);
router.post("/drafts", controller.draft);
router.put("/drafts/:id", controller.updateDraft);
router.post("/drafts/:id/send", controller.sendDraft);
router.post("/drafts/:id/discard", controller.discardDraft);

module.exports = router;
