const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const tourController = require("../controllers/tourController");

// The guided tour is a meta feature available on every plan and to locked /
// past-due accounts (so they can still learn the product). It only requires a
// valid session — no lockout or feature gate.
router.use(auth);

router.get("/status", tourController.getTourStatus);
router.post("/progress", tourController.saveTourProgress);
router.post("/complete", tourController.completeTour);

module.exports = router;
