/**
 * Time-of-day helpers so Echo always greets the owner correctly in THEIR local
 * timezone. The owner's timezone comes from their brand settings (the
 * availability_schedules timezone — the same source the content calendar uses,
 * since brands has no timezone column). Falls back to Eastern Time when no
 * brand has one configured (owner requirement: admin defaults to Eastern).
 *
 * Parts of day (owner requirement):
 *   05:00–11:59 → morning    ("Good morning Sir")
 *   12:00–16:59 → afternoon  ("Good afternoon Sir")
 *   17:00–20:59 → evening    ("Good evening Sir")
 *   21:00–04:59 → late       ("Working late Sir")
 * Echo must NEVER say "Good morning" outside the morning window.
 */

const db = require("../config/db");
const { isValidTimezone } = require("./timezone");

const DEFAULT_TIMEZONE = "America/New_York";

/** The hour (0-23) right now in the given IANA timezone (fallback Eastern → UTC). */
function hourInTimezone(timeZone, now = new Date()) {
  const tz = isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    // hourCycle quirks can yield 24 for midnight in some ICU versions.
    if (Number.isFinite(h)) return h === 24 ? 0 : h;
  } catch {
    /* fall through to UTC */
  }
  return now.getUTCHours();
}

/** Maps an hour (0-23) to Echo's part of day. */
function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "late"; // 21:00–04:59
}

/** The spoken greeting for a part of day. Never "Good morning" off-hours. */
function greetingFor(part, name) {
  const who = name || "Sir";
  switch (part) {
    case "afternoon":
      return `Good afternoon ${who}.`;
    case "evening":
      return `Good evening ${who}.`;
    case "late":
      return `Working late ${who}?`;
    default:
      return `Good morning ${who}.`;
  }
}

/** The greeting with no name attached ("Good afternoon."), for neutral copy. */
function greetingBare(part) {
  switch (part) {
    case "afternoon":
      return "Good afternoon.";
    case "evening":
      return "Good evening.";
    case "late":
      return "Working late?";
    default:
      return "Good morning.";
  }
}

/**
 * The owner's timezone from their brand settings: the first valid
 * availability-schedule timezone across their real (non-demo) brands.
 * Falls back to Eastern (owner requirement for the admin account).
 */
async function resolveUserTimezone(userId) {
  try {
    const { rows } = await db.query(
      `SELECT s.timezone
         FROM availability_schedules s
         JOIN brands b ON b.brand_id = s.brand_id
        WHERE b.user_id = $1 AND b.is_demo = false
          AND s.timezone IS NOT NULL AND btrim(s.timezone) <> ''
        ORDER BY s.brand_id`,
      [userId]
    );
    for (const r of rows) {
      const tz = r.timezone && String(r.timezone).trim();
      if (isValidTimezone(tz)) return tz;
    }
  } catch (err) {
    console.error("resolveUserTimezone failed (using Eastern):", err.message);
  }
  return DEFAULT_TIMEZONE;
}

/** { timezone, hour, part } for the owner's local clock right now. */
async function userPartOfDay(userId, now = new Date()) {
  const timezone = await resolveUserTimezone(userId);
  const hour = hourInTimezone(timezone, now);
  return { timezone, hour, part: partOfDay(hour) };
}

module.exports = {
  DEFAULT_TIMEZONE,
  hourInTimezone,
  partOfDay,
  greetingFor,
  greetingBare,
  resolveUserTimezone,
  userPartOfDay,
};
