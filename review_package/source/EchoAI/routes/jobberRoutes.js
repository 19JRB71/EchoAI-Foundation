const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");
const jobberController = require("../controllers/jobberController");

// OAuth callback is a top-level GET redirect from Jobber — NO auth middleware
// (the browser carries no Authorization header). CSRF is enforced via the
// session state stored at initiate time.
router.get("/oauth/callback", jobberController.oauthCallback);

// Everything else is authenticated with the bearer JWT. Intentionally NOT
// lockout-gated, mirroring the Google/Facebook OAuth routes: connection
// management should keep working for account recovery.
router.post("/oauth/initiate", auth, jobberController.initiateOAuth);
router.get("/status", auth, jobberController.getConnectionStatus);
router.post("/disconnect", auth, jobberController.disconnect);

// Operational data routes ARE lockout-gated (locked/past-due accounts keep
// connection management above, but not paid data actions).
router.post("/clients/import", auth, lockoutCheck, jobberController.importClients);
router.get("/schedule", auth, lockoutCheck, jobberController.getSchedule);
router.post("/leads/:leadId/send", auth, lockoutCheck, jobberController.sendLeadToJobber);

module.exports = router;
