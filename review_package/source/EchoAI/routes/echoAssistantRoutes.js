const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const controller = require("../controllers/echoAssistantController");

// The personal assistant is the OWNER's private reminder + task list — staff
// members never see or manage it.
router.use(auth, lockout, requireOwner);

// Voice command (transcript → AI-parsed intent → action + spoken reply).
router.post("/command", controller.handleCommand);

// Reminders
router.get("/reminders", controller.listReminders);
router.post("/reminders", controller.createReminder);
router.put("/reminders/:id", controller.updateReminder);
router.post("/reminders/:id/complete", controller.completeReminder);
router.delete("/reminders/:id", controller.deleteReminder);

// Tasks
router.get("/tasks", controller.listTasks);
router.post("/tasks", controller.createTask);
router.put("/tasks/:id", controller.updateTask);
router.post("/tasks/:id/complete", controller.completeTask);
router.delete("/tasks/:id", controller.deleteTask);

module.exports = router;
