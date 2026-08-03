/**
 * Unified Approvals Inbox routes (Prompt 019).
 * Owner-only: approvals are the owner's decisions (D-28 §11). auth + lockout
 * like every dashboard surface; requireOwner keeps team members out.
 */

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const controller = require("../controllers/approvalsController");

router.use(auth, lockout, requireOwner);

router.get("/", controller.getInbox);
router.post("/tasks/:taskId/resolve", controller.resolveTask);

module.exports = router;
