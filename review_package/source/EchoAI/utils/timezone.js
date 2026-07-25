/**
 * Timezone helpers for converting a wall-clock time in a named IANA timezone to
 * the correct absolute UTC instant (DST-safe). Used anywhere we need to schedule
 * something at a specific local time for a brand (e.g. content-calendar posts at
 * 8am/12pm/6pm in the business owner's timezone) and store it as a TIMESTAMPTZ.
 *
 * The technique mirrors the Intl-based approach used in the appointment
 * scheduler: format the instant in the target zone to discover its offset, then
 * subtract the offset (with one correction pass for DST boundary edges).
 */

/** True when `tz` is a usable IANA timezone name for Intl.DateTimeFormat. */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds that `timeZone` is ahead of/behind UTC at the given instant. */
function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - date.getTime();
}

/**
 * Converts a wall-clock time (y, m [1-12], d, hh, mm) interpreted in `timeZone`
 * to the matching UTC Date. Falls back to treating the time as UTC when the
 * timezone is invalid so a bad brand config can never throw here.
 */
function zonedWallTimeToUtc(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  if (!isValidTimezone(timeZone)) return new Date(guess);
  const offset = tzOffsetMs(timeZone, new Date(guess));
  let result = new Date(guess - offset);
  // One correction pass handles DST boundary edges.
  const offset2 = tzOffsetMs(timeZone, result);
  if (offset2 !== offset) result = new Date(guess - offset2);
  return result;
}

module.exports = { isValidTimezone, tzOffsetMs, zonedWallTimeToUtc };
