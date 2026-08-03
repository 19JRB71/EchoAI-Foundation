const db = require("../config/db");
const taskSpine = require("../utils/taskSpine");

/**
 * Prompt 019 — Unified Approvals Inbox (D-28 §11-14, D-29 authorization).
 *
 * The inbox is the ONE canonical place an owner discovers everything waiting
 * on their decision. It is a PROJECTION ONLY (D-29): every item is read live
 * from its feature's own table on every request — the inbox holds no state of
 * its own, caches no decisions, and never writes a feature table directly.
 *
 * Two item classes, visibly badged (D-29):
 *   - 'spine'   — agent_tasks rows in MANUAL_REVIEW. Resolution here IS a
 *                 recorded spine transition with actor owner:<userId> (I-31).
 *   - 'adapter' — transitional read-only projections over feature approval
 *                 tables that have not adopted the Task Spine yet. Each
 *                 adapter declares its retirement; actions on adapter items
 *                 delegate to the feature's EXISTING endpoints (the client
 *                 links there) — the inbox never mutates feature tables.
 *
 * Adapter inventory is a RATCHET (D-29): it only shrinks. Every future
 * adoption prompt must update this inventory.
 * Excluded by owner ruling: voice-content drafts (session-scoped, not an
 * approval queue).
 */

const ADAPTERS = [
  {
    key: "autopilot_item",
    feature: "Autopilot weekly batch review",
    retirement: "Retires when Autopilot posts/ads adopt the spine end-to-end (020-series adoption wave)",
  },
  {
    key: "growth_action",
    feature: "Autonomous Growth Mode proposals",
    retirement: "Retires with the Autopilot/growth spine adoption wave (020-series)",
  },
  {
    key: "company_truth",
    feature: "Company Truth report approval",
    retirement: "Retires when Company Truth generation adopts the spine (011-series follow-up)",
  },
  {
    key: "email_draft",
    feature: "Email Assistant reply drafts",
    retirement: "Retires when notification/assistant mails adopt the email_send spine",
  },
];

/**
 * GET /api/approvals?brandId=<optional>
 * Live aggregation of everything awaiting the owner. Deterministic: same DB
 * state -> same payload; no caching, no stored inbox state.
 */
async function getInbox(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.query;
  const brandFilter = brandId ? " AND b.brand_id = $2" : "";
  const params = brandId ? [userId, brandId] : [userId];

  try {
    const [manualReview, autopilot, growth, truth, drafts] = await Promise.all([
      db.query(
        `SELECT t.task_id, t.task_type, t.source_type, t.source_id, t.attempt,
                t.title, t.last_error, t.updated_at, t.created_at, t.brand_id,
                b.brand_name
           FROM agent_tasks t
           JOIN brands b ON b.brand_id = t.brand_id
          WHERE b.user_id = $1 AND t.status = 'MANUAL_REVIEW'${brandFilter}
          ORDER BY t.updated_at DESC
          LIMIT 100`,
        params
      ),
      db.query(
        `SELECT i.item_id, i.item_type, i.platform, i.post_content, i.scheduled_time,
                i.created_at, ab.brand_id, b.brand_name
           FROM autopilot_batch_items i
           JOIN autopilot_batches ab ON ab.batch_id = i.batch_id
           JOIN brands b ON b.brand_id = ab.brand_id
          WHERE b.user_id = $1 AND i.status = 'pending' AND ab.status = 'ready'${brandFilter}
          ORDER BY i.created_at DESC
          LIMIT 100`,
        params
      ),
      brandId
        ? db.query(
            `SELECT g.action_id, g.title, g.created_at, g.brand_id, b.brand_name
               FROM growth_actions g
               JOIN brands b ON b.brand_id = g.brand_id
              WHERE g.user_id = $1 AND g.status = 'proposed' AND b.brand_id = $2
              ORDER BY g.created_at DESC
              LIMIT 100`,
            params
          )
        : db.query(
            `SELECT g.action_id, g.title, g.created_at, g.brand_id, b.brand_name
               FROM growth_actions g
               LEFT JOIN brands b ON b.brand_id = g.brand_id
              WHERE g.user_id = $1 AND g.status = 'proposed'
              ORDER BY g.created_at DESC
              LIMIT 100`,
            [userId]
          ),
      db.query(
        `SELECT r.report_id, r.version, r.created_at, r.brand_id, b.brand_name
           FROM company_truth_reports r
           JOIN brands b ON b.brand_id = r.brand_id
          WHERE b.user_id = $1 AND r.status = 'pending_approval'${brandFilter}
          ORDER BY r.created_at DESC
          LIMIT 20`,
        params
      ),
      // Email drafts are user-scoped (no brand column) — never brand-filtered.
      db.query(
        `SELECT d.draft_id, d.to_address, d.to_name, d.subject, d.created_at
           FROM email_drafts d
          WHERE d.user_id = $1 AND d.status = 'pending'
          ORDER BY d.created_at DESC
          LIMIT 100`,
        [userId]
      ),
    ]);

    const items = [
      ...manualReview.rows.map((t) => ({
        id: `task:${t.task_id}`,
        source: "spine",
        kind: "manual_review",
        feature: "Task Spine — needs review",
        title: t.title,
        detail: t.last_error || null,
        brandId: t.brand_id,
        brandName: t.brand_name,
        createdAt: t.updated_at || t.created_at,
        taskId: t.task_id,
        taskType: t.task_type,
        sourceType: t.source_type,
        sourceRef: `${t.source_id} (attempt ${t.attempt})`,
        actions: ["confirm_handled", "dismiss"],
      })),
      ...autopilot.rows.map((i) => ({
        id: `autopilot:${i.item_id}`,
        source: "adapter",
        kind: "autopilot_item",
        feature: "Autopilot",
        title: `${i.item_type === "ad" ? "Ad" : "Post"}${i.platform ? ` (${i.platform})` : ""}: ${String(i.post_content || "").slice(0, 120)}`,
        detail: i.scheduled_time ? `Proposed for ${i.scheduled_time}` : null,
        brandId: i.brand_id,
        brandName: i.brand_name,
        createdAt: i.created_at,
        goToSection: "autopilot",
      })),
      ...growth.rows.map((g) => ({
        id: `growth:${g.action_id}`,
        source: "adapter",
        kind: "growth_action",
        feature: "Autonomous Growth",
        title: g.title,
        detail: null,
        brandId: g.brand_id,
        brandName: g.brand_name,
        createdAt: g.created_at,
        goToSection: "echogrowth",
      })),
      ...truth.rows.map((r) => ({
        id: `truth:${r.report_id}`,
        source: "adapter",
        kind: "company_truth",
        feature: "Company Truth",
        title: `Company Truth report v${r.version} awaiting your approval`,
        detail: null,
        brandId: r.brand_id,
        brandName: r.brand_name,
        createdAt: r.created_at,
        goToSection: "sage",
      })),
      ...drafts.rows.map((d) => ({
        id: `draft:${d.draft_id}`,
        source: "adapter",
        kind: "email_draft",
        feature: "Email Assistant",
        title: `Draft reply to ${d.to_name || d.to_address}: ${d.subject}`,
        detail: null,
        brandId: null,
        brandName: null,
        createdAt: d.created_at,
        goToSection: "echoemail",
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      items,
      counts: {
        total: items.length,
        spine: manualReview.rows.length,
        adapter: items.length - manualReview.rows.length,
      },
      adapterInventory: ADAPTERS,
    });
  } catch (err) {
    console.error("Approvals inbox error:", err.message);
    return res.status(500).json({ error: "Failed to load the approvals inbox" });
  }
}

/**
 * POST /api/approvals/tasks/:taskId/resolve  { resolution, note? }
 * The owner's resolution of a MANUAL_REVIEW task (I-31). This IS a recorded
 * spine transition with actor owner:<userId> — never a bare status edit:
 *   resolution 'confirm_handled' -> COMPLETED (owner confirmed it is handled)
 *   resolution 'dismiss'         -> CANCELLED (owner closed it, no action)
 * Guarded UPDATE inside the spine: a concurrent resolution loses the race and
 * gets an honest 409.
 */
async function resolveTask(req, res) {
  const userId = req.user.userId;
  const { taskId } = req.params;
  const { resolution, note } = req.body || {};
  if (!["confirm_handled", "dismiss"].includes(resolution)) {
    return res.status(400).json({ error: "resolution must be 'confirm_handled' or 'dismiss'" });
  }

  try {
    const owned = await db.query(
      `SELECT t.task_id, t.status
         FROM agent_tasks t
         JOIN brands b ON b.brand_id = t.brand_id
        WHERE t.task_id = $1 AND b.user_id = $2`,
      [taskId, userId]
    );
    const task = owned.rows[0];
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.status !== "MANUAL_REVIEW") {
      return res.status(409).json({ error: "This task is no longer waiting for review" });
    }

    const to = resolution === "confirm_handled" ? "COMPLETED" : "CANCELLED";
    const row = await taskSpine.transition({
      taskId,
      to,
      actor: `owner:${userId}`,
      meta: {
        resolution,
        note: note ? String(note).slice(0, 500) : undefined,
        via: "approvals_inbox",
      },
    });
    if (!row) {
      return res.status(409).json({ error: "This task was already resolved" });
    }
    return res.json({ taskId, status: row.status });
  } catch (err) {
    console.error("Approvals resolve error:", err.message);
    return res.status(500).json({ error: "Failed to resolve the task" });
  }
}

module.exports = { getInbox, resolveTask, ADAPTERS };
