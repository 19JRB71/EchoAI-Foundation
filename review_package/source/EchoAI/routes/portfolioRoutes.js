const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireRole } = require("../middleware/rolePermissions");
const portfolio = require("../controllers/portfolioController");

// Echo's Multi-Business Chief of Staff spans the whole account, so it is
// owner/admin-only (requireRole('admin') also allows the owner; the platform
// admin bypasses). There is NO tier gate — the portfolio view is available on
// every plan; it just shows however many real businesses the owner has.
// Order is always auth → lockout → role.
router.use(auth, lockout, requireRole("admin"));

router.get("/overview", portfolio.getOverview);
router.get("/health", portfolio.getHealth);
router.post("/health/run", portfolio.runHealth);
router.get("/intelligence", portfolio.getIntelligence);
router.post("/intelligence/generate", portfolio.generateIntelligence);
router.get("/team", portfolio.getTeam);

module.exports = router;
