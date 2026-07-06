/**
 * Proactive channel/tool suggestions for Echo's weekly briefing.
 *
 * Echo looks at gaps in the owner's OWN account — channels and tools they have
 * not set up or used yet — and surfaces the highest-leverage next one. Every
 * reason is grounded in the owner's real usage; we NEVER fabricate competitor
 * data or market claims. Nudges are deduped so Echo never nags: a suggestion
 * shown in the last 30 days is suppressed, one declined in the last 90 days is
 * suppressed, and one already accepted is never suggested again (see the
 * 059_echo_suggestions.sql migration).
 */
const db = require("../config/db");

// How many suggestions to surface per weekly briefing. Kept small so the spoken
// briefing stays short and the owner isn't overwhelmed.
const MAX_SUGGESTIONS = 2;

// Catalog of suggestable channels/tools. `section` is the client nav key the
// "set it up" action navigates to. `detect` returns true when the owner ALREADY
// uses the channel (so it is NOT a gap and should not be suggested). `reason` is
// grounded purely in the owner's own account (no external/competitor claims).
// Ordered by priority — highest-leverage first.
const CATALOG = [
  {
    key: "chatbot",
    channel: "Website chatbot",
    section: "chatbot",
    reason:
      "your website chatbot isn't live yet — it captures and qualifies leads 24/7 while you're busy",
    async detect(brandIds) {
      return countExists(
        "SELECT 1 FROM chatbot_config WHERE brand_id = ANY($1) LIMIT 1",
        [brandIds],
      );
    },
  },
  {
    key: "email",
    channel: "Email marketing",
    section: "email",
    reason:
      "you haven't sent any email campaigns yet — email is the cheapest way to turn the leads you already have into repeat customers",
    async detect(brandIds) {
      return countExists(
        "SELECT 1 FROM email_campaigns WHERE brand_id = ANY($1) LIMIT 1",
        [brandIds],
      );
    },
  },
  {
    key: "contentcalendar",
    channel: "Content calendar",
    section: "contentcalendar",
    reason:
      "you don't have any social posts scheduled — a content calendar keeps you visible without daily effort",
    async detect(brandIds) {
      return countExists(
        "SELECT 1 FROM social_posts WHERE brand_id = ANY($1) LIMIT 1",
        [brandIds],
      );
    },
  },
  {
    key: "sms",
    channel: "SMS marketing",
    section: "sms",
    reason:
      "you're not using SMS yet — texts get opened fast and are great for time-sensitive offers to your existing leads",
    async detect(brandIds) {
      return countExists(
        "SELECT 1 FROM sms_campaigns WHERE brand_id = ANY($1) LIMIT 1",
        [brandIds],
      );
    },
  },
  {
    key: "phone",
    channel: "AI phone agent",
    section: "phone",
    reason:
      "the AI phone agent isn't set up — it answers and qualifies callers so you never miss a lead when you can't pick up",
    async detect(brandIds) {
      return countExists(
        "SELECT 1 FROM twilio_config WHERE brand_id = ANY($1) LIMIT 1",
        [brandIds],
      );
    },
  },
];

// Existence check: true if the query returns any row. Deliberately does NOT
// swallow errors — a probe failure must NOT be read as "no usage" (that would
// manufacture a false gap and surface an ungrounded suggestion). computeSuggestions
// catches a throw and fails closed by skipping that channel.
async function countExists(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows.length > 0;
}

// Stable set of suggestable keys — used to reject unknown keys on decision.
const VALID_KEYS = new Set(CATALOG.map((c) => c.key));

function isValidKey(key) {
  return VALID_KEYS.has(key);
}

// The owner's real (non-demo) brand ids. Returns [] on any error.
async function ownerBrandIds(userId) {
  try {
    const { rows } = await db.query(
      "SELECT brand_id FROM brands WHERE user_id = $1 AND is_demo = false",
      [userId],
    );
    return rows.map((r) => r.brand_id);
  } catch (_e) {
    return [];
  }
}

// Keys currently suppressed by the dedup policy (recently shown, recently
// declined, or already accepted). Returns a Set for O(1) filtering.
async function suppressedKeys(userId) {
  try {
    const { rows } = await db.query(
      `SELECT suggestion_key FROM echo_suggestions
        WHERE user_id = $1 AND (
              status = 'accepted'
           OR (status = 'shown'    AND shown_at   > NOW() - INTERVAL '30 days')
           OR (status = 'declined' AND decided_at > NOW() - INTERVAL '90 days')
        )`,
      [userId],
    );
    return new Set(rows.map((r) => r.suggestion_key));
  } catch (_e) {
    return new Set();
  }
}

/**
 * Compute the proactive suggestions to surface for an owner this week. Read-only
 * — recording that they were shown happens separately (recordShown) at delivery
 * time so gathering briefing data has no side effects. Returns an array of
 * `{ key, channel, section, reason }`, at most MAX_SUGGESTIONS, or [].
 */
async function computeSuggestions(userId) {
  const brandIds = await ownerBrandIds(userId);
  if (brandIds.length === 0) return [];
  const suppressed = await suppressedKeys(userId);

  const out = [];
  for (const item of CATALOG) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (suppressed.has(item.key)) continue;
    // Only real gaps are suggested. If the usage probe fails for any reason we
    // fail CLOSED (skip this channel) rather than risk suggesting something the
    // owner already uses — suggestions must be grounded in real account state.
    let alreadyUses;
    try {
      alreadyUses = await item.detect(brandIds);
    } catch (_e) {
      continue;
    }
    if (alreadyUses) continue;
    out.push({
      key: item.key,
      channel: item.channel,
      section: item.section,
      reason: item.reason,
    });
  }
  return out;
}

/**
 * Record that a set of suggestions was shown (resets the 30-day dedup window).
 * Best-effort — never throws so it can't break briefing delivery.
 */
async function recordShown(userId, keys) {
  const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
  for (const key of list) {
    try {
      await db.query(
        `INSERT INTO echo_suggestions (user_id, suggestion_key, status, shown_at)
         VALUES ($1, $2, 'shown', NOW())
         ON CONFLICT (user_id, suggestion_key)
         DO UPDATE SET status = 'shown', shown_at = NOW(), updated_at = NOW()
         WHERE echo_suggestions.status <> 'accepted'`,
        [userId, key],
      );
    } catch (e) {
      console.error(`recordShown failed for ${key}:`, e.message);
    }
  }
}

/**
 * Record the owner's decision on a suggestion ("accepted" | "declined").
 * Upserts so a decision on a never-shown key is still captured. Returns true on
 * success. Throws on a bad decision value (caller maps to 400).
 */
async function recordDecision(userId, key, decision) {
  if (decision !== "accepted" && decision !== "declined") {
    throw new Error("Invalid decision");
  }
  if (!isValidKey(key)) {
    throw new Error("Unknown suggestion key");
  }
  await db.query(
    `INSERT INTO echo_suggestions (user_id, suggestion_key, status, decided_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, suggestion_key)
     DO UPDATE SET status = $3, decided_at = NOW(), updated_at = NOW()`,
    [userId, key, decision],
  );
  return true;
}

module.exports = {
  computeSuggestions,
  recordShown,
  recordDecision,
  isValidKey,
  MAX_SUGGESTIONS,
  CATALOG,
};
