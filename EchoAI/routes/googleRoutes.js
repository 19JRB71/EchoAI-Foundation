const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const googleController = require("../controllers/googleController");

// OAuth callback is a top-level GET redirect from Google — NO auth middleware
// (the browser carries no Authorization header). CSRF is enforced via the
// session state stored at initiate time.
router.get("/oauth/callback", googleController.oauthCallback);

// Everything else is authenticated with the bearer JWT. These are intentionally
// NOT lockout-gated: a connected Google account drives analytics/insights and
// should keep working, but more importantly initiation requires a valid login
// only. (Connect/disconnect/status mirror the Facebook OAuth routes.)
router.post("/oauth/initiate", auth, googleController.initiateOAuth);
router.get("/status", auth, googleController.getConnectionStatus);
router.post("/disconnect", auth, googleController.disconnect);

router.get("/business-profile", auth, googleController.getBusinessProfile);
router.get("/analytics", auth, googleController.getAnalytics);
router.get("/ads/performance", auth, googleController.getAdsPerformance);

module.exports = router;
