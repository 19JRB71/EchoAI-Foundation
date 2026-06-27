const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const fbOAuth = require("../controllers/facebookOAuthController");

// `initiate` is an authenticated POST (JWT in the Authorization header) that
// returns the Facebook dialog URL; the client then navigates to it. This keeps
// the bearer token out of URLs/logs/history. The `callback` is reached by
// Facebook's top-level GET redirect and authenticates via the session.
router.post("/oauth/initiate", auth, fbOAuth.initiateOAuth);
router.get("/oauth/callback", fbOAuth.oauthCallback);

// Management endpoints use the normal JWT auth header (called via fetch).
router.get("/accounts", auth, fbOAuth.getConnectedAccounts);
router.post("/select-account", auth, fbOAuth.selectAccount);
router.post("/disconnect", auth, fbOAuth.disconnectAccount);

module.exports = router;
