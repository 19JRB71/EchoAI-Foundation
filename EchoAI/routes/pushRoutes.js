const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const pushController = require("../controllers/pushController");

// Push routes require authentication but are intentionally NOT lockout-gated:
// a customer who is past-due / locked should still be able to receive (and keep
// receiving) hot-lead alerts that motivate them to come back and pay.
router.use(auth);

router.get("/vapid-public-key", pushController.getVapidPublicKey);
router.post("/subscribe", pushController.saveSubscription);

module.exports = router;
