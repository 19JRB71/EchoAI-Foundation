const express = require("express");

const demoController = require("./../controllers/demoController");

const router = express.Router();

// Public landing-page demo request. No authentication — visitors do not have
// an account yet.
router.post("/request", demoController.submitDemoRequest);

module.exports = router;
