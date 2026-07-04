const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const controller = require("../controllers/agentsController");

// The AI Marketing Department is the whole team's navigation model, so invited
// team members can load it too (not just the owner). The controller filters the
// owner-only Sentinel oversight agent out of the roster for team members.
router.use(auth, lockout);

// Org-wide command center rollup. Registered before "/:agentId" so it isn't
// captured by the param route.
router.get("/mission-control", controller.getMissionControl);

// The team roster with live status + weekly results.
router.get("/", controller.getAgents);

// A single team member's detailed view (activity log, tasks, metrics).
router.get("/:agentId", controller.getAgentDetail);

module.exports = router;
