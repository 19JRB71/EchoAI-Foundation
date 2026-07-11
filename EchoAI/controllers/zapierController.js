const db = require("../config/db");
const { WEBHOOK_EVENT_KEYS, isValidEvent } = require("../config/webhookEvents");
const { isAllowedWebhookUrl } = require("../config/webhooks");
const { deliver } = require("../utils/webhookDispatcher");

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name FROM brands WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/** Loads a webhook only if its brand belongs to the authenticated user. */
async function getOwnedWebhook(userId, webhookId) {
  const result = await db.query(
    `SELECT w.webhook_id, w.brand_id, w.event_name, w.webhook_url, w.is_active
     FROM webhooks w
     JOIN brands b ON b.brand_id = w.brand_id
     WHERE w.webhook_id = $1 AND b.user_id = $2`,
    [webhookId, userId],
  );
  return result.rows[0] || null;
}

/**
 * POST /api/webhooks
 * Subscribes a brand's webhook URL to a trigger event (called by Zapier when a
 * user sets up a Zap, or directly from the dashboard).
 */
async function createWebhook(req, res) {
  const userId = req.user.userId;
  const { brandId, eventName, webhookUrl } = req.body;

  if (!brandId || !eventName || !webhookUrl) {
    return res
      .status(400)
      .json({ error: "brandId, eventName, and webhookUrl are required" });
  }
  if (!isValidEvent(eventName)) {
    return res.status(400).json({
      error: `Unsupported eventName. Supported: ${WEBHOOK_EVENT_KEYS.join(", ")}`,
    });
  }
  if (!isAllowedWebhookUrl(webhookUrl)) {
    return res.status(400).json({
      error: "webhookUrl must be a public https URL (private/internal hosts are not allowed)",
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows } = await db.query(
      `INSERT INTO webhooks (brand_id, event_name, webhook_url)
       VALUES ($1, $2, $3)
       RETURNING webhook_id, brand_id, event_name, webhook_url, is_active,
                 last_triggered_at, created_at`,
      [brandId, eventName, String(webhookUrl).trim()],
    );
    return res.status(201).json({ webhook: rows[0] });
  } catch (err) {
    console.error("Create webhook error:", err.message);
    return res.status(500).json({ error: "Failed to create webhook" });
  }
}

/**
 * DELETE /api/webhooks/:webhookId
 * Removes a webhook subscription (ownership enforced via the brands join).
 */
async function deleteWebhook(req, res) {
  const userId = req.user.userId;
  const { webhookId } = req.params;
  try {
    const { rows } = await db.query(
      `DELETE FROM webhooks w
       USING brands b
       WHERE w.webhook_id = $1 AND w.brand_id = b.brand_id AND b.user_id = $2
       RETURNING w.webhook_id`,
      [webhookId, userId],
    );
    if (!rows.length) return res.status(404).json({ error: "Webhook not found" });
    return res.json({ deleted: true, webhookId: rows[0].webhook_id });
  } catch (err) {
    console.error("Delete webhook error:", err.message);
    return res.status(500).json({ error: "Failed to delete webhook" });
  }
}

/**
 * GET /api/webhooks/:brandId
 * Lists a brand's active webhook subscriptions.
 */
async function listWebhooks(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows } = await db.query(
      `SELECT webhook_id, brand_id, event_name, webhook_url, is_active,
              last_triggered_at, created_at
       FROM webhooks
       WHERE brand_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [brandId],
    );
    return res.json({ webhooks: rows });
  } catch (err) {
    console.error("List webhooks error:", err.message);
    return res.status(500).json({ error: "Failed to list webhooks" });
  }
}

/**
 * POST /api/webhooks/test
 * Sends a sample payload to a webhook so Zapier (or the user) can verify the
 * connection works. Awaits the delivery and surfaces the result.
 */
async function testWebhook(req, res) {
  const userId = req.user.userId;
  const { webhookId } = req.body;
  if (!webhookId) {
    return res.status(400).json({ error: "webhookId is required" });
  }
  try {
    const webhook = await getOwnedWebhook(userId, webhookId);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });

    const payload = {
      event: webhook.event_name,
      test: true,
      brandId: webhook.brand_id,
      triggeredAt: new Date().toISOString(),
      data: {
        message: "This is a test payload from Zorecho.",
        event: webhook.event_name,
      },
    };
    const result = await deliver(webhook, webhook.event_name, payload);
    await db
      .query(`UPDATE webhooks SET last_triggered_at = NOW() WHERE webhook_id = $1`, [
        webhook.webhook_id,
      ])
      .catch(() => {});

    if (!result.success) {
      return res.status(502).json({
        error: "The webhook URL did not accept the test payload.",
        status: result.status ?? null,
      });
    }
    return res.json({ success: true, status: result.status });
  } catch (err) {
    console.error("Test webhook error:", err.message);
    return res.status(500).json({ error: "Failed to test webhook" });
  }
}

/**
 * Internal: fan an event out to every active webhook subscribed to it for a
 * brand. Fire-and-forget — callers should NOT await this so the main flow is
 * never blocked. Never throws.
 */
async function triggerWebhook(brandId, eventName, data) {
  try {
    if (!brandId || !isValidEvent(eventName)) return;
    const { rows } = await db.query(
      `SELECT webhook_id, brand_id, event_name, webhook_url
       FROM webhooks
       WHERE brand_id = $1 AND event_name = $2 AND is_active = TRUE`,
      [brandId, eventName],
    );
    if (!rows.length) return;

    const payload = {
      event: eventName,
      brandId,
      triggeredAt: new Date().toISOString(),
      data: data ?? {},
    };
    await Promise.all(
      rows.map(async (webhook) => {
        await deliver(webhook, eventName, payload);
        await db
          .query(`UPDATE webhooks SET last_triggered_at = NOW() WHERE webhook_id = $1`, [
            webhook.webhook_id,
          ])
          .catch(() => {});
      }),
    );
  } catch (err) {
    console.error(`Webhook trigger (${eventName}) failed:`, err.message);
  }
}

module.exports = {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  testWebhook,
  triggerWebhook,
};
