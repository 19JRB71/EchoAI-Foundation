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

// Billing-management routes are auth-only (NOT lockout-gated) on purpose: a
// past-due / locked customer must still be able to view billing, change plan,
// and update their card to recover their account.
router.get("/plans", authMiddleware, subscriptionController.getPlans);
router.post("/change", authMiddleware, subscriptionController.changeSubscription);
router.post("/team", authMiddleware, subscriptionController.updateTeamSize);
router.get("/payment-method", authMiddleware, subscriptionController.getPaymentMethod);
router.post("/payment-method", authMiddleware, subscriptionController.updatePaymentMethod);
router.get("/invoices", authMiddleware, subscriptionController.getBillingHistory);
router.get("/upcoming-invoice", authMiddleware, subscriptionController.getUpcomingInvoice);

module.exports = router;
