const express = require("express");

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

// Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);

// Protected routes (require a valid JWT)
router.get("/profile", authMiddleware, authController.getProfile);
router.put("/profile", authMiddleware, authController.updateProfile);
router.put("/profile/onboarding", authMiddleware, authController.updateOnboarding);

module.exports = router;
