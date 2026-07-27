/**
 * Department Collaboration — the Collaboration Bus chokepoint (Stage 0).
 *
 * ALL inter-department communication flows through this module and the
 * department_messages table. Approved baseline:
 * ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md (§3, §10, Appendices A/B).
 *
 * Chokepoint rules enforced HERE (never left to prompts):
 *  1. Schema-only payloads (additionalProperties rejected, not stripped).
 *  2. Topic must exist in the Knowledge Registry; to_dept must be its owner.
 *  3. Only the topic's owner may respond — even Echo cannot answer for others.
 *  4. Brand-scoped everything; demo brands excluded at the bus level.
 *  5. Requests must expire (answer_by; default 24h). Nothing waits forever.
 *  6. Anti-loop: non-Echo departments may never create a request in reaction
 *     to a response (requests can't carry correlation_id at all — DB CHECK);
 *     Echo plan mechanics arrive in Stage 3 (plan_id column reserved).
 *  7. Per-brand daily message cap (structural cost bound).
 *  8. Input-hash dedup: a request matching an answered one inside the topic's
 *     freshness window is served from the logged response, free.
 *  9. No secrets/PII: denylisted keys rejected deep (Appendix B).
 * 10. Messages are immutable once terminal; transitions are status-guarded,
 *     row-count-branched atomic UPDATEs (Appendix A).
 *
 * Flag: COLLAB_BUS (default OFF) => every entry point no-ops with an honest
 * { enabled: false }. The table stays dormant while dark.
 */

const crypto = require("crypto");
const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const {
  getTopic,
  DEPARTMENTS,
  validatePayload,
  findDenylistedKey,
} = require("../config/knowledgeRegistry");

const DEFAULT_ANSWER_HOURS = 24;
const DAILY_BRAND_MESSAGE_CAP = 200; // generous, but finite (§10.3)
const RETENTION_DAYS = 180; // Appendix B
const PURGE_BATCH_LIMIT = 5000;

function disabled() {
  return { enabled: false };
}

async function busEnabled() {
  return getSwitch("COLLAB_BUS");
}

function inputHash(topic, payload) {
  return crypto
    .createHash("sha256")
    .update(topic + "\n" + JSON.stringify(payload, Object.keys(payload).sort()))
    .digest("hex");
}

async function realBrand(brandId) {
  const { rows } = await db.query(
    "SELECT brand_id FROM brands WHERE brand_id = $1 AND is_demo = false",
    [brandId],
  );
  return rows.length > 0;
}

async function underDailyCap(brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM department_messages
      WHERE brand_id = $1 AND created_at >= date_trunc('day', NOW())`,
    [brandId],
  );
  return rows[0].n < DAILY_BRAND_MESSAGE_CAP;
}

/** Shared pre-flight for every send. Returns { error } or { topicDef }. */
async function preflight({ brandId, fromDept, toDept, topic, payload, kind }) {
  if (!DEPARTMENTS.includes(fromDept)) return { error: `Unknown department "${fromDept}".` };
  if (!DEPARTMENTS.includes(toDept)) return { error: `Unknown department "${toDept}".` };
  const topicDef = getTopic(topic);
  if (!topicDef) return { error: `Unknown topic "${topic}" — not in the Knowledge Registry.` };
  // Routing: requests go TO the owner; reports go FROM the owner to any
  // consumer (sendReport enforces the owner side); alerts only through Echo.
  if (kind === "alert") {
    if (toDept !== "echo") return { error: "Alerts route only through Echo." };
  } else if (kind !== "report" && toDept !== topicDef.owner) {
    return { error: `Topic "${topic}" is owned by ${topicDef.owner}, not ${toDept}.` };
  }
  if (fromDept === toDept) return { error: "A department cannot message itself." };
  // Requests + alerts carry request-shaped payloads; responses and reports
  // carry the topic's fact (response) shape.
  const schema = ["response", "report"].includes(kind) ? topicDef.response : topicDef.request;
  const schemaErr = validatePayload(schema, payload);
  if (schemaErr) return { error: schemaErr };
  const badKey = findDenylistedKey(payload);
  if (badKey) return { error: `Payload key "${badKey}" is denylisted (no secrets on the bus).` };
  if (!(await realBrand(brandId))) return { error: "Unknown or demo brand — bus is real-brands only." };
  if (!(await underDailyCap(brandId))) return { error: "Daily collaboration message cap reached for this brand." };
  return { topicDef };
}

/**
 * Send a request to a topic's owner. Dedup-served from the log when an
 * answered request with the same (brand, topic, payload-hash) is fresh.
 */
async function sendRequest({ brandId, fromDept, topic, payload = {}, priority = "routine", answerByHours }) {
  if (!(await busEnabled())) return disabled();
  const topicDef = getTopic(topic);
  const pre = await preflight({
    brandId, fromDept, toDept: topicDef ? topicDef.owner : "echo", topic, payload, kind: "request",
  });
  if (pre.error) return { ok: false, error: pre.error };

  const hash = inputHash(topic, payload);

  // §10.2 dedup: serve the logged response, free — no consumer wake-up.
  if (pre.topicDef.freshnessMinutes > 0) {
    const { rows: fresh } = await db.query(
      `SELECT resp.payload AS response_payload, req.message_id AS request_id
         FROM department_messages req
         JOIN department_messages resp
           ON resp.correlation_id = req.message_id AND resp.kind = 'response'
        WHERE req.brand_id = $1 AND req.topic = $2 AND req.input_hash = $3
          AND req.kind = 'request' AND req.status = 'answered'
          AND req.answered_at >= NOW() - ($4 || ' minutes')::interval
        ORDER BY req.answered_at DESC
        LIMIT 1`,
      [brandId, topic, hash, String(pre.topicDef.freshnessMinutes)],
    );
    if (fresh.length > 0) {
      return {
        ok: true,
        deduplicated: true,
        requestId: fresh[0].request_id,
        response: fresh[0].response_payload,
      };
    }
  }

  const hours = Number.isFinite(answerByHours) && answerByHours > 0 ? answerByHours : DEFAULT_ANSWER_HOURS;
  const { rows } = await db.query(
    `INSERT INTO department_messages
       (brand_id, from_dept, to_dept, kind, topic, payload, priority, answer_by, input_hash)
     VALUES ($1, $2, $3, 'request', $4, $5::jsonb, $6, NOW() + ($7 || ' hours')::interval, $8)
     RETURNING message_id, answer_by`,
    [brandId, fromDept, pre.topicDef.owner, topic, JSON.stringify(payload), priority, String(hours), hash],
  );
  return { ok: true, deduplicated: false, requestId: rows[0].message_id, answerBy: rows[0].answer_by };
}

/** Atomic claim (Appendix A): sent -> claimed, only by the owning department. */
async function claimRequest({ requestId, dept }) {
  if (!(await busEnabled())) return disabled();
  const { rowCount, rows } = await db.query(
    `UPDATE department_messages
        SET status = 'claimed', claimed_at = NOW()
      WHERE message_id = $1 AND kind = 'request' AND status = 'sent' AND to_dept = $2
      RETURNING message_id, brand_id, topic, payload, from_dept`,
    [requestId, dept],
  );
  if (rowCount === 0) return { ok: false, error: "Request not claimable (wrong department, already claimed, or terminal)." };
  // Defensive registry check: even if a malformed row was inserted manually,
  // only the topic's registered owner may hold a claim.
  const topicDef = getTopic(rows[0].topic);
  if (!topicDef || topicDef.owner !== dept) {
    await db.query(
      `UPDATE department_messages SET status = 'sent', claimed_at = NULL
        WHERE message_id = $1 AND status = 'claimed'`,
      [requestId],
    );
    return { ok: false, error: `Only the registered owner of "${rows[0].topic}" may claim this request.` };
  }
  return { ok: true, request: rows[0] };
}

/**
 * Answer or decline a request. One transaction: insert the response row +
 * flip the request — they can never disagree (Appendix A). Only the topic's
 * owner may respond; a decline requires a plain-English reason.
 */
async function respondToRequest({ requestId, dept, payload, decline = false, declineReason }) {
  if (!(await busEnabled())) return disabled();
  if (decline && !(typeof declineReason === "string" && declineReason.trim())) {
    return { ok: false, error: "A decline requires a plain-English reason." };
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: reqRows } = await client.query(
      `SELECT message_id, brand_id, topic, from_dept, to_dept, status
         FROM department_messages
        WHERE message_id = $1 AND kind = 'request'
        FOR UPDATE`,
      [requestId],
    );
    if (reqRows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Request not found." };
    }
    const req = reqRows[0];
    const topicDef = getTopic(req.topic);
    if (!topicDef || topicDef.owner !== dept || req.to_dept !== dept) {
      await client.query("ROLLBACK");
      return { ok: false, error: `Only ${topicDef ? topicDef.owner : "the topic owner"} may respond to "${req.topic}" — even Echo cannot answer for others.` };
    }
    if (!["sent", "claimed"].includes(req.status)) {
      await client.query("ROLLBACK");
      return { ok: false, error: `Request is already ${req.status} — terminal states are final.` };
    }
    const respPayload = decline
      ? { available: false, reason: declineReason.trim() }
      : payload;
    const schemaErr = validatePayload(topicDef.response, respPayload || {});
    if (schemaErr) {
      await client.query("ROLLBACK");
      return { ok: false, error: schemaErr };
    }
    const badKey = findDenylistedKey(respPayload);
    if (badKey) {
      await client.query("ROLLBACK");
      return { ok: false, error: `Payload key "${badKey}" is denylisted (no secrets on the bus).` };
    }
    let respRow;
    try {
      const ins = await client.query(
        `INSERT INTO department_messages
           (brand_id, from_dept, to_dept, kind, topic, payload, correlation_id, status, answered_at)
         VALUES ($1, $2, $3, 'response', $4, $5::jsonb, $6, $7, NOW())
         RETURNING message_id`,
        [req.brand_id, dept, req.from_dept, req.topic, JSON.stringify(respPayload),
         requestId, decline ? "declined" : "answered"],
      );
      respRow = ins.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") {
        return { ok: false, error: "This request already has a response (one response per request)." };
      }
      throw err;
    }
    const flip = await client.query(
      `UPDATE department_messages
          SET status = $2, answered_at = NOW(), error_message = $3
        WHERE message_id = $1 AND kind = 'request' AND status IN ('sent','claimed')`,
      [requestId, decline ? "declined" : "answered", decline ? declineReason.trim() : null],
    );
    if (flip.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Request state changed concurrently — nothing written." };
    }
    await client.query("COMMIT");
    return { ok: true, responseId: respRow.message_id, declined: decline };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fire-and-forget fact flow (terminal at birth). Only a topic's OWNER may
 * publish a report about it (facts come from the department that owns the
 * data); the recipient is any other department that consumes them.
 */
async function sendReport({ brandId, fromDept, toDept, topic, payload = {} }) {
  if (!(await busEnabled())) return disabled();
  const topicDef = getTopic(topic);
  if (topicDef && topicDef.owner !== fromDept) {
    return { ok: false, error: `Only ${topicDef.owner} may publish reports on "${topic}" (topic owner only).` };
  }
  const pre = await preflight({ brandId, fromDept, toDept, topic, payload, kind: "report" });
  if (pre.error) return { ok: false, error: pre.error };
  const { rows } = await db.query(
    `INSERT INTO department_messages
       (brand_id, from_dept, to_dept, kind, topic, payload, status)
     VALUES ($1, $2, $3, 'report', $4, $5::jsonb, 'sent')
     RETURNING message_id`,
    [brandId, fromDept, toDept, topic, JSON.stringify(payload)],
  );
  return { ok: true, reportId: rows[0].message_id };
}

/** Owner-attention fact — routes ONLY through Echo (§3.1/§8). */
async function sendAlert({ brandId, fromDept, topic, payload = {}, priority = "routine" }) {
  if (!(await busEnabled())) return disabled();
  const pre = await preflight({ brandId, fromDept, toDept: "echo", topic, payload, kind: "alert" });
  if (pre.error) return { ok: false, error: pre.error };
  const { rows } = await db.query(
    `INSERT INTO department_messages
       (brand_id, from_dept, to_dept, kind, topic, payload, status, priority)
     VALUES ($1, $2, 'echo', 'alert', $3, $4::jsonb, 'sent', $5)
     RETURNING message_id`,
    [brandId, fromDept, topic, JSON.stringify(payload), priority],
  );
  return { ok: true, alertId: rows[0].message_id };
}

/**
 * Nightly maintenance (flag-gated branch of the existing maintenance job —
 * NOT a new scheduled job). Appendix A + B:
 *  - overdue sent/claimed requests -> expired (status-guarded);
 *  - stale claimed rows (claimed > 2h with no answer) -> failed with an
 *    honest error_message (never silently retried);
 *  - rows past 180-day retention purged (batch-limited).
 */
async function runBusMaintenance() {
  if (!(await busEnabled())) return { enabled: false };
  const expired = await db.query(
    `UPDATE department_messages
        SET status = 'expired',
            error_message = 'No response before the deadline (answer_by passed).'
      WHERE kind = 'request' AND status IN ('sent','claimed')
        AND answer_by IS NOT NULL AND answer_by < NOW()`,
  );
  const failed = await db.query(
    `UPDATE department_messages
        SET status = 'failed',
            error_message = 'Consumer claimed this request but never answered (stale claim rescue).'
      WHERE kind = 'request' AND status = 'claimed'
        AND claimed_at < NOW() - interval '2 hours'
        AND (answer_by IS NULL OR answer_by >= NOW())`,
  );
  const purged = await db.query(
    `DELETE FROM department_messages
      WHERE message_id IN (
        SELECT message_id FROM department_messages
         WHERE created_at < NOW() - ($1 || ' days')::interval
         LIMIT ${PURGE_BATCH_LIMIT}
      )`,
    [String(RETENTION_DAYS)],
  );
  return { enabled: true, expired: expired.rowCount, failed: failed.rowCount, purged: purged.rowCount };
}

/** Recent brand-scoped activity (owner-gated endpoints only — Stage 2 UI). */
async function getRecentActivity({ brandId, limit = 50 }) {
  if (!(await busEnabled())) return disabled();
  const { rows } = await db.query(
    `SELECT message_id, from_dept, to_dept, kind, topic, status, priority,
            correlation_id, error_message, created_at, answered_at
       FROM department_messages
      WHERE brand_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [brandId, Math.min(Math.max(1, limit), 200)],
  );
  return { enabled: true, messages: rows };
}

module.exports = {
  sendRequest,
  claimRequest,
  respondToRequest,
  sendReport,
  sendAlert,
  runBusMaintenance,
  getRecentActivity,
  inputHash,
  DAILY_BRAND_MESSAGE_CAP,
  DEFAULT_ANSWER_HOURS,
  RETENTION_DAYS,
};
