const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const appointments = require("../controllers/appointmentController");

// ---------------------------------------------------------------------------
// All appointment routes require auth, an account in good standing, the
// Professional tier (admins bypass), and block read-only team members from
// mutating. Order is always auth -> lockout -> featureGate -> denyViewerMutations.
// ---------------------------------------------------------------------------
router.use(auth, lockout, featureGate("appointments"), denyViewerMutations);

// Availability configuration
router.get("/config/:brandId", appointments.getAvailabilityConfig);
router.put("/config/:brandId", appointments.saveAvailabilityConfig);

// Blackout blocks
router.post("/blocks", appointments.addBlock);
router.delete("/blocks/:blockId", appointments.deleteBlock);

// Open slots (for the booking UI + availability preview)
router.get("/slots/:brandId", appointments.getOpenSlots);

// Appointments
router.get("/list/:brandId", appointments.getAppointments);
router.post("/", appointments.bookAppointment);
router.patch("/:appointmentId", appointments.updateAppointment);

module.exports = router;
