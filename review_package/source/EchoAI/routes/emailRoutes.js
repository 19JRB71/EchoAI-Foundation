const express = require("express");

const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const emailController = require("../controllers/emailController");

const router = express.Router();

// Email test routes are for the platform owner only: a valid session (auth)
// AND an admin role (admin).
router.use(authMiddleware);
router.use(adminMiddleware);

// Manually trigger any email type with sample data for testing deliverability.
router.post("/test", emailController.triggerTestEmail);

module.exports = router;
