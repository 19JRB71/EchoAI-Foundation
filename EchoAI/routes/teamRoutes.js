const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireRole } = require("../middleware/rolePermissions");
const teamController = require("../controllers/teamController");

// Accepting an invitation only needs a valid login (the invitee may be a brand
// new account that is not yet a team member). No lockout / role gate here.
router.post("/accept", auth, teamController.acceptInvitation);

// All team-management routes require auth + an active subscription + at least
// the workspace "admin" role (managers and viewers are blocked). The platform
// admin bypasses the role check.
router.use(auth, lockout, requireRole("admin"));

router.get("/", teamController.listMembers);
router.post("/invite", teamController.inviteMember);
router.post("/resend", teamController.resendInvite);
router.put("/role", teamController.changeRole);
router.post("/deactivate", teamController.deactivateMember);
router.post("/reactivate", teamController.reactivateMember);
router.delete("/:teamMemberId", teamController.removeMember);

module.exports = router;
