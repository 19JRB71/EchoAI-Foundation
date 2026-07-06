const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const goalController = require("../controllers/goalController");

// Goals are available on every tier — auth + lockout only (no feature gate).
router.use(auth, lockout);

// Cross-brand overview (Mission Control) — declared before the :brandId routes
// so "overview" isn't captured as a brand id.
router.get("/overview", goalController.getOverview);

router.get("/catalog/:brandId", goalController.getCatalog);
// Conversational goal setup (AI parse) — POST before the generic create route.
router.post("/:brandId/parse", goalController.parseGoals);
router.get("/:brandId", goalController.listGoals);
router.get("/:brandId/department/:department", goalController.getDepartmentGoals);
// Goal-alert feed management (dismiss one alert / mute a goal's future alerts).
router.get("/:brandId/alerts", goalController.getGoalAlerts);
router.post("/:brandId/alerts/:alertId/dismiss", goalController.dismissGoalAlert);
router.post("/:brandId/:goalId/alerts/mute", goalController.setGoalAlertMute);
router.post("/:brandId", goalController.createGoal);
router.put("/:brandId/:goalId", goalController.updateGoal);
router.delete("/:brandId/:goalId", goalController.deleteGoal);

module.exports = router;
