const express = require("express");

const subscriptionController = require("../controllers/subscriptionController");
const authMiddleware = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");
const { requireRole } = require("../middleware/rolePermissions");

const router = express.Router();

// Billing & subscription management is restricted to the workspace admin role
// and above (managers and viewers are blocked); the platform admin bypasses it.
const adminOnly = requireRole("admin");

// Stripe webhook — must NOT use auth middleware (Stripe calls it directly) and
// must receive the raw body so the signature can be verified.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  subscriptionController.handleWebhook
);

// Authenticated subscription management routes.
router.post("/", authMiddleware, lockoutCheck, adminOnly, subscriptionController.createSubscription);
router.post("/cancel", authMiddleware, lockoutCheck, adminOnly, subscriptionController.cancelSubscription);

// Read-only status/plans are available to any authenticated workspace user so
// the app can render the current plan and lockout state. No payment details.
router.get("/status", authMiddleware, subscriptionController.getSubscriptionStatus);
router.get("/plans", authMiddleware, subscriptionController.getPlans);

// Billing-management routes are auth-only (NOT lockout-gated) on purpose: a
// past-due / locked customer must still be able to view billing, change plan,
// and update their card to recover their account. Admin role required.
router.post("/change", authMiddleware, adminOnly, subscriptionController.changeSubscription);
router.post("/team", authMiddleware, adminOnly, subscriptionController.updateTeamSize);
router.get("/payment-method", authMiddleware, adminOnly, subscriptionController.getPaymentMethod);
router.post("/payment-method", authMiddleware, adminOnly, subscriptionController.updatePaymentMethod);
router.get("/invoices", authMiddleware, adminOnly, subscriptionController.getBillingHistory);
router.get("/upcoming-invoice", authMiddleware, adminOnly, subscriptionController.getUpcomingInvoice);

module.exports = router;
