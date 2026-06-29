const express = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

// Stricter limiter on the credential endpoints to blunt brute-force and
// credential-stuffing attacks (the global /api limiter is far too generous for
// login). Successful requests don't count, so a legitimate user logging in
// repeatedly is never locked out — only failed attempts burn the budget.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Public routes
router.post("/register", authLimiter, authController.register);
router.post("/login", authLimiter, authController.login);

// Protected routes (require a valid JWT)
router.get("/profile", authMiddleware, authController.getProfile);
router.put("/profile", authMiddleware, authController.updateProfile);
router.put("/profile/onboarding", authMiddleware, authController.updateOnboarding);

module.exports = router;
