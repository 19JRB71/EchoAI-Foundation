const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const controller = require("../controllers/agentsController");

// The AI Marketing Department view is the owner's command center — restricted to
// the account owner (or admin), consistent with Echo and the Setup Agent.
router.use(auth, lockout, requireOwner);

// Org-wide command center rollup. Registered before "/:agentId" so it isn't
// captured by the param route.
router.get("/mission-control", controller.getMissionControl);

// The team roster with live status + weekly results.
router.get("/", controller.getAgents);

// A single team member's detailed view (activity log, tasks, metrics).
router.get("/:agentId", controller.getAgentDetail);

module.exports = router;
