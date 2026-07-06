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
router.get("/:brandId", goalController.listGoals);
router.get("/:brandId/department/:department", goalController.getDepartmentGoals);
router.post("/:brandId", goalController.createGoal);
router.put("/:brandId/:goalId", goalController.updateGoal);
router.delete("/:brandId/:goalId", goalController.deleteGoal);

module.exports = router;
