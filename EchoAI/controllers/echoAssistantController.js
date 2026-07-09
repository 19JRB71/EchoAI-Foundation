/**
 * Echo Personal Assistant — reminders + tasks API.
 *
 * Dashboard CRUD (owner-scoped by user_id; workspace members never see the
 * owner's personal list) plus the voice command endpoint: the client sends the
 * raw transcript ("remind me to call Robert at 2pm tomorrow", "mark off number
 * two") and Anthropic parses it into a structured intent that is validated and
 * executed here. AI upstream failures map to 502, never mocked.
 */
const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const { RECURRENCES, PRIORITIES } = require("../utils/echoPersonal");

const REMINDER_STATUSES = ["scheduled", "notifying", "delivered", "completed", "cancelled"];

function ownerId(req) {
  return req.user.userId;
}

function cleanText(value, max = 500) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function parseDueAt(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function serializeReminder(r) {
  return {
    reminderId: r.reminder_id,
    text: r.reminder_text,
    dueAt: r.due_at,
    recurrence: r.recurrence,
    status: r.status,
    deliveryChannel: r.delivery_channel,
    source: r.source,
    deliveredAt: r.delivered_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}

function serializeTask(t) {
  return {
    taskId: t.task_id,
    text: t.task_text,
    priority: t.priority,
    dueDate: t.due_date,
    status: t.status,
    source: t.source,
    createdAt: t.created_at,
    completedAt: t.completed_at,
  };
}

// ---------------------------------------------------------------------------
// Reminders CRUD
// ---------------------------------------------------------------------------

/** GET /api/echo-assistant/reminders — upcoming first, then recent history. */
async function listReminders(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM echo_reminders
        WHERE user_id = $1
        ORDER BY (status IN ('scheduled','notifying')) DESC, due_at ASC
        LIMIT 200`,
      [ownerId(req)]
    );
    return res.json({ reminders: rows.map(serializeReminder) });
  } catch (err) {
    console.error("listReminders failed:", err.message);
    return res.status(500).json({ error: "Failed to load reminders" });
  }
}

/** POST /api/echo-assistant/reminders */
async function createReminder(req, res) {
  const text = cleanText(req.body && req.body.text);
  const dueAt = parseDueAt(req.body && req.body.dueAt);
  const recurrence = (req.body && req.body.recurrence) || "none";
  if (!text) return res.status(400).json({ error: "Reminder text is required" });
  if (!dueAt) return res.status(400).json({ error: "A valid due date and time is required" });
  if (!RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: "Recurrence must be none, daily, weekly, or monthly" });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO echo_reminders (user_id, reminder_text, due_at, recurrence, source)
       VALUES ($1, $2, $3, $4, 'dashboard') RETURNING *`,
      [ownerId(req), text, dueAt, recurrence]
    );
    return res.status(201).json({ reminder: serializeReminder(rows[0]) });
  } catch (err) {
    console.error("createReminder failed:", err.message);
    return res.status(500).json({ error: "Failed to create reminder" });
  }
}

/** PUT /api/echo-assistant/reminders/:id */
async function updateReminder(req, res) {
  const text = cleanText(req.body && req.body.text);
  const dueAt = parseDueAt(req.body && req.body.dueAt);
  const recurrence = req.body && req.body.recurrence;
  if (!text && !dueAt && !recurrence) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (recurrence && !RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: "Recurrence must be none, daily, weekly, or monthly" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE echo_reminders
          SET reminder_text = COALESCE($3, reminder_text),
              due_at = COALESCE($4, due_at),
              recurrence = COALESCE($5, recurrence),
              -- Re-arm a delivered reminder when its time is moved to the future.
              status = CASE WHEN $4::timestamptz IS NOT NULL AND $4::timestamptz > NOW()
                            AND status IN ('delivered','notifying') THEN 'scheduled'
                            ELSE status END,
              updated_at = NOW()
        WHERE reminder_id = $1 AND user_id = $2 AND status <> 'cancelled'
        RETURNING *`,
      [req.params.id, ownerId(req), text, dueAt, recurrence || null]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Reminder not found" });
    return res.json({ reminder: serializeReminder(rows[0]) });
  } catch (err) {
    console.error("updateReminder failed:", err.message);
    return res.status(500).json({ error: "Failed to update reminder" });
  }
}

/** POST /api/echo-assistant/reminders/:id/complete */
async function completeReminder(req, res) {
  try {
    const { rows } = await db.query(
      `UPDATE echo_reminders
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE reminder_id = $1 AND user_id = $2
          AND status IN ('scheduled','notifying','delivered')
        RETURNING *`,
      [req.params.id, ownerId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Reminder not found" });
    return res.json({ reminder: serializeReminder(rows[0]) });
  } catch (err) {
    console.error("completeReminder failed:", err.message);
    return res.status(500).json({ error: "Failed to complete reminder" });
  }
}

/** DELETE /api/echo-assistant/reminders/:id */
async function deleteReminder(req, res) {
  try {
    const result = await db.query(
      `UPDATE echo_reminders
          SET status = 'cancelled', updated_at = NOW()
        WHERE reminder_id = $1 AND user_id = $2 AND status <> 'cancelled'`,
      [req.params.id, ownerId(req)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Reminder not found" });
    return res.status(204).end();
  } catch (err) {
    console.error("deleteReminder failed:", err.message);
    return res.status(500).json({ error: "Failed to delete reminder" });
  }
}

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

/** GET /api/echo-assistant/tasks — open by priority, then recent completed. */
async function listTasks(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM echo_tasks
        WHERE user_id = $1
        ORDER BY (status = 'open') DESC,
                 CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 due_date ASC NULLS LAST, created_at DESC
        LIMIT 300`,
      [ownerId(req)]
    );
    return res.json({ tasks: rows.map(serializeTask) });
  } catch (err) {
    console.error("listTasks failed:", err.message);
    return res.status(500).json({ error: "Failed to load tasks" });
  }
}

/** POST /api/echo-assistant/tasks */
async function createTask(req, res) {
  const text = cleanText(req.body && req.body.text);
  const priority = (req.body && req.body.priority) || "medium";
  const dueDate = req.body && req.body.dueDate ? parseDueAt(req.body.dueDate) : null;
  if (!text) return res.status(400).json({ error: "Task text is required" });
  if (!PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Priority must be high, medium, or low" });
  }
  if (req.body && req.body.dueDate && !dueDate) {
    return res.status(400).json({ error: "Invalid due date" });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO echo_tasks (user_id, task_text, priority, due_date, source)
       VALUES ($1, $2, $3, $4, 'dashboard') RETURNING *`,
      [ownerId(req), text, priority, dueDate]
    );
    return res.status(201).json({ task: serializeTask(rows[0]) });
  } catch (err) {
    console.error("createTask failed:", err.message);
    return res.status(500).json({ error: "Failed to create task" });
  }
}

/** PUT /api/echo-assistant/tasks/:id */
async function updateTask(req, res) {
  const text = cleanText(req.body && req.body.text);
  const priority = req.body && req.body.priority;
  const hasDue = req.body && Object.prototype.hasOwnProperty.call(req.body, "dueDate");
  const dueDate = hasDue && req.body.dueDate ? parseDueAt(req.body.dueDate) : null;
  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Priority must be high, medium, or low" });
  }
  if (hasDue && req.body.dueDate && !dueDate) {
    return res.status(400).json({ error: "Invalid due date" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE echo_tasks
          SET task_text = COALESCE($3, task_text),
              priority = COALESCE($4, priority),
              due_date = CASE WHEN $5 THEN $6::date ELSE due_date END,
              updated_at = NOW()
        WHERE task_id = $1 AND user_id = $2
        RETURNING *`,
      [req.params.id, ownerId(req), text, priority || null, !!hasDue, dueDate]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Task not found" });
    return res.json({ task: serializeTask(rows[0]) });
  } catch (err) {
    console.error("updateTask failed:", err.message);
    return res.status(500).json({ error: "Failed to update task" });
  }
}

/** POST /api/echo-assistant/tasks/:id/complete */
async function completeTask(req, res) {
  try {
    const { rows } = await db.query(
      `UPDATE echo_tasks
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE task_id = $1 AND user_id = $2 AND status = 'open'
        RETURNING *`,
      [req.params.id, ownerId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Task not found" });
    return res.json({ task: serializeTask(rows[0]) });
  } catch (err) {
    console.error("completeTask failed:", err.message);
    return res.status(500).json({ error: "Failed to complete task" });
  }
}

/** DELETE /api/echo-assistant/tasks/:id */
async function deleteTask(req, res) {
  try {
    const result = await db.query(
      `DELETE FROM echo_tasks WHERE task_id = $1 AND user_id = $2`,
      [req.params.id, ownerId(req)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Task not found" });
    return res.status(204).end();
  } catch (err) {
    console.error("deleteTask failed:", err.message);
    return res.status(500).json({ error: "Failed to delete task" });
  }
}

// ---------------------------------------------------------------------------
// Voice command — AI intent parsing
// ---------------------------------------------------------------------------

const COMMAND_SYSTEM_PROMPT = `You are Echo's personal-assistant intent parser. The user speaks a command about their personal reminders or task list. Parse it into EXACTLY ONE JSON object with no other text.

Schema:
{
  "action": "create_reminder" | "create_task" | "complete_task" | "complete_reminder" | "delete_task" | "cancel_reminder" | "list_tasks" | "list_reminders" | "none",
  "text": string,            // for create_*: the cleaned reminder/task description (e.g. "call Robert")
  "dueAtISO": string|null,   // for create_reminder: the due datetime as an ISO 8601 string WITH the user's UTC offset
  "recurrence": "none"|"daily"|"weekly"|"monthly",  // create_reminder only
  "priority": "high"|"medium"|"low",                // create_task only; default "medium"; urgent/asap/important => "high"
  "dueDateISO": string|null, // create_task only: a plain date (YYYY-MM-DD) when the user named a day, else null
  "targetId": string|null,   // for complete/delete/cancel: the id of the matching item from the provided lists, else null
  "reply": string            // one short spoken confirmation, addressing the user as "Sir" (e.g. "Got it Sir, I will remind you to call Robert tomorrow at 2 PM.")
}

Rules:
- Resolve relative dates/times ("tomorrow at 2pm", "Friday at 10am", "Tuesday") against the provided current datetime and timezone. Never place a new reminder in the past — pick the next future occurrence.
- "every Monday morning" => recurrence "weekly" with the next Monday ~9am. "every day/morning" => "daily". "every month" => "monthly".
- For complete/delete/cancel, match the spoken description ("the bank call is done", "mark off number two") to the numbered lists provided and set targetId. If nothing matches, action "none" with a reply asking which item they mean (end it with a question mark).
- If the command has a day but no time for a reminder, choose 9:00 AM local.
- If the command is not about reminders or tasks at all, action "none" with reply "".
- Keep replies short, natural, and spoken-friendly. No emojis, no markdown.`;

function extractJson(response) {
  const text =
    response && Array.isArray(response.content)
      ? response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
      : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * POST /api/echo-assistant/command — { text, timezone }
 * Parses the transcript into an intent, executes it, and returns the spoken
 * reply. The open task list and upcoming reminders are given to the model so
 * "mark off number two" / "the bank call is done" resolve to real ids.
 */
async function handleCommand(req, res) {
  const text = cleanText(req.body && req.body.text, 1000);
  const timezone = cleanText(req.body && req.body.timezone, 60) || "UTC";
  if (!text) return res.status(400).json({ error: "text is required" });
  const userId = ownerId(req);

  try {
    const [taskRows, reminderRows] = await Promise.all([
      db.query(
        `SELECT task_id, task_text, priority FROM echo_tasks
          WHERE user_id = $1 AND status = 'open'
          ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                   created_at ASC
          LIMIT 40`,
        [userId]
      ),
      db.query(
        `SELECT reminder_id, reminder_text, due_at FROM echo_reminders
          WHERE user_id = $1 AND status IN ('scheduled','notifying','delivered')
          ORDER BY due_at ASC LIMIT 40`,
        [userId]
      ),
    ]);

    let nowLocal;
    try {
      nowLocal = new Date().toLocaleString("en-US", { timeZone: timezone, hour12: true });
    } catch {
      return res.status(400).json({ error: "Invalid timezone" });
    }

    const taskList = taskRows.rows
      .map((t, i) => `${i + 1}. [id ${t.task_id}] (${t.priority}) ${t.task_text}`)
      .join("\n");
    const reminderList = reminderRows.rows
      .map((r, i) => `${i + 1}. [id ${r.reminder_id}] ${r.reminder_text} — due ${new Date(r.due_at).toISOString()}`)
      .join("\n");

    let response;
    try {
      response = await createMessage(
        {
          model: MODEL,
          max_tokens: 500,
          system: COMMAND_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Current datetime: ${nowLocal} (${timezone}). Current UTC: ${new Date().toISOString()}.

Open tasks:
${taskList || "(none)"}

Upcoming reminders:
${reminderList || "(none)"}

Command: "${text}"`,
            },
          ],
        },
        { label: "Echo assistant command" }
      );
    } catch (err) {
      console.error("Assistant command AI call failed:", err.message);
      return res.status(502).json({ error: "Echo's AI is unavailable right now. Please try again." });
    }

    const intent = extractJson(response);
    if (!intent || typeof intent.action !== "string") {
      return res.status(502).json({ error: "Echo couldn't understand that command. Please try again." });
    }

    const reply = cleanText(intent.reply, 600) || "";
    const result = await module.exports.executeIntent(userId, intent, {
      taskRows: taskRows.rows,
      reminderRows: reminderRows.rows,
    });
    return res.json({
      action: intent.action,
      reply: result.reply || reply,
      isQuestion: /\?\s*$/.test(result.reply || reply),
      handled: result.handled,
    });
  } catch (err) {
    console.error("handleCommand failed:", err.message);
    return res.status(500).json({ error: "Failed to process the command" });
  }
}

/** Executes a validated intent. Returns { handled, reply } (reply may be ""). */
async function executeIntent(userId, intent, context) {
  const action = intent.action;
  const reply = cleanText(intent.reply, 600) || "";

  if (action === "create_reminder") {
    const text = cleanText(intent.text);
    const dueAt = parseDueAt(intent.dueAtISO);
    const recurrence = RECURRENCES.includes(intent.recurrence) ? intent.recurrence : "none";
    if (!text || !dueAt) {
      return { handled: false, reply: "I didn't catch when to remind you, Sir. Could you say the time again?" };
    }
    if (recurrence === "none" && dueAt.getTime() < Date.now() - 60000) {
      return { handled: false, reply: "That time has already passed, Sir. When should I remind you?" };
    }
    await db.query(
      `INSERT INTO echo_reminders (user_id, reminder_text, due_at, recurrence, source)
       VALUES ($1, $2, $3, $4, 'voice')`,
      [userId, text, dueAt, recurrence]
    );
    return { handled: true, reply };
  }

  if (action === "create_task") {
    const text = cleanText(intent.text);
    const priority = PRIORITIES.includes(intent.priority) ? intent.priority : "medium";
    const dueDate = intent.dueDateISO ? parseDueAt(intent.dueDateISO) : null;
    if (!text) {
      return { handled: false, reply: "What should the task say, Sir?" };
    }
    const inserted = await db.query(
      `INSERT INTO echo_tasks (user_id, task_text, priority, due_date, source)
       VALUES ($1, $2, $3, $4, 'voice') RETURNING task_id`,
      [userId, text, priority, dueDate]
    );
    // High-priority tasks are flagged immediately by voice.
    if (priority === "high") {
      await enqueueOwnerVoiceEvent(
        userId,
        "task_alert",
        (firstName) => `${firstName}, I flagged that as high priority: ${text}.`,
        {
          title: "High-priority task",
          payload: { taskId: inserted.rows[0].task_id },
          dedupKey: `taskhigh:${inserted.rows[0].task_id}`,
          expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        }
      );
    }
    return { handled: true, reply };
  }

  if (action === "complete_task" || action === "delete_task") {
    const targetId = cleanText(intent.targetId, 60);
    const known = (context.taskRows || []).some((t) => t.task_id === targetId);
    if (!targetId || !known) {
      return { handled: false, reply: reply || "Which task should I update, Sir?" };
    }
    if (action === "complete_task") {
      await db.query(
        `UPDATE echo_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW()
          WHERE task_id = $1 AND user_id = $2 AND status = 'open'`,
        [targetId, userId]
      );
    } else {
      await db.query(`DELETE FROM echo_tasks WHERE task_id = $1 AND user_id = $2`, [targetId, userId]);
    }
    return { handled: true, reply };
  }

  if (action === "complete_reminder" || action === "cancel_reminder") {
    const targetId = cleanText(intent.targetId, 60);
    const known = (context.reminderRows || []).some((r) => r.reminder_id === targetId);
    if (!targetId || !known) {
      return { handled: false, reply: reply || "Which reminder do you mean, Sir?" };
    }
    const status = action === "complete_reminder" ? "completed" : "cancelled";
    await db.query(
      `UPDATE echo_reminders
          SET status = $3, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END,
              updated_at = NOW()
        WHERE reminder_id = $1 AND user_id = $2 AND status <> 'cancelled'`,
      [targetId, userId, status]
    );
    return { handled: true, reply };
  }

  if (action === "list_tasks") {
    const tasks = context.taskRows || [];
    if (tasks.length === 0) return { handled: true, reply: "Your task list is clear, Sir." };
    const spoken = tasks
      .slice(0, 8)
      .map((t, i) => `${i + 1}: ${t.task_text}`)
      .join(". ");
    return {
      handled: true,
      reply: `Sir, you have ${tasks.length} open task${tasks.length === 1 ? "" : "s"}. ${spoken}. Anything I should mark off?`,
    };
  }

  if (action === "list_reminders") {
    const reminders = (context.reminderRows || []).filter((r) => new Date(r.due_at) > new Date());
    if (reminders.length === 0) return { handled: true, reply: "You have no upcoming reminders, Sir." };
    const spoken = reminders
      .slice(0, 8)
      .map((r) => r.reminder_text)
      .join(". ");
    return {
      handled: true,
      reply: `Sir, you have ${reminders.length} upcoming reminder${reminders.length === 1 ? "" : "s"}: ${spoken}.`,
    };
  }

  return { handled: false, reply };
}

module.exports = {
  listReminders,
  createReminder,
  updateReminder,
  completeReminder,
  deleteReminder,
  listTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  handleCommand,
  executeIntent,
  // exported for tests
  extractJson,
  REMINDER_STATUSES,
};
