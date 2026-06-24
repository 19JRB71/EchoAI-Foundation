const express = require("express");

const subscriptionController = require("../controllers/subscriptionController");
const authMiddleware = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");

const router = express.Router();

// Stripe webhook — must NOT use auth middleware (Stripe calls it directly) and
// must receive the raw body so the signature can be verified.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  subscriptionController.handleWebhook
);

// Authenticated subscription management routes.
router.post("/", authMiddleware, lockoutCheck, subscriptionController.createSubscription);
router.post("/cancel", authMiddleware, lockoutCheck, subscriptionController.cancelSubscription);
router.get("/status", authMiddleware, subscriptionController.getSubscriptionStatus);

module.exports = router;
