const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const taskActivityController = require("../controllers/taskActivityController");

// Read-only Approvals & Activity (Prompt 009). Authenticated + active
// subscription; brand/task ownership is enforced inside the controller.
router.use(auth, lockout);

router.get("/activity", taskActivityController.getActivity);
router.get("/:taskId/events", taskActivityController.getTaskEvents);

module.exports = router;
