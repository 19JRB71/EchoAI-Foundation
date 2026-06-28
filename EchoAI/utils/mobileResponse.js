/**
 * Mobile API (/api/v2) response helpers.
 *
 * Every mobile endpoint returns the SAME envelope so the React Native client can
 * parse responses uniformly:
 *
 *   {
 *     "status":  "success" | "error",
 *     "data":     <payload> | null,
 *     "message":  <human-readable string>,
 *     "pagination": { "nextCursor": <string|null>, "hasMore": <bool>, "limit": <int> } | null
 *   }
 *
 * It also provides consistent CURSOR-BASED pagination. A cursor is an opaque,
 * base64url-encoded JSON snapshot of the last row's sort keys (created_at + id),
 * which is far more efficient and stable on mobile than OFFSET paging (no skipped
 * or duplicated rows when data changes between page loads).
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Send a success envelope. `pagination` is optional (list endpoints only). */
function success(res, { data = null, message = "OK", pagination = null, status = 200 } = {}) {
  return res.status(status).json({
    status: "success",
    data,
    message,
    pagination,
  });
}

/** Send an error envelope. Use the same shape so clients never special-case errors. */
function fail(res, { status = 400, message = "Request failed", data = null } = {}) {
  return res.status(status).json({
    status: "error",
    data,
    message,
    pagination: null,
  });
}

/**
 * Normalize a client-supplied `limit` query param into a safe integer.
 */
function parseLimit(rawLimit) {
  const n = parseInt(rawLimit, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Encode a cursor from the last item's sort keys. Returns null for an empty key.
 * @param {{createdAt: (string|Date), id: string}} keys
 */
function encodeCursor(keys) {
  if (!keys || keys.createdAt == null || keys.id == null) return null;
  const createdAt =
    keys.createdAt instanceof Date ? keys.createdAt.toISOString() : String(keys.createdAt);
  const json = JSON.stringify({ c: createdAt, i: keys.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode a cursor back into its sort keys. Returns null if absent or malformed
 * (callers treat a malformed cursor as "start from the beginning").
 */
function decodeCursor(rawCursor) {
  if (!rawCursor) return null;
  try {
    const json = Buffer.from(String(rawCursor), "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed || parsed.c == null || parsed.i == null) return null;
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Build the pagination block from a result set fetched with `limit + 1` rows.
 * Trims the extra row, computes hasMore, and emits the nextCursor.
 *
 * @param {Array} rows           rows fetched with one extra (limit + 1)
 * @param {number} limit         the requested page size
 * @param {(row:any)=>{createdAt:any,id:any}} keyOf  maps a row to its sort keys
 * @returns {{ items: Array, pagination: object }}
 */
function paginate(rows, limit, keyOf) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(keyOf(last)) : null;
  return {
    items,
    pagination: { nextCursor, hasMore, limit },
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  success,
  fail,
  parseLimit,
  encodeCursor,
  decodeCursor,
  paginate,
};
