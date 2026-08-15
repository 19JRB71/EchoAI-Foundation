/**
 * Prompt 035 Stage 2 (Section C1-B): DETERMINISTIC business-hours parser.
 *
 * Converts an owner's verbatim hours answer ("Monday through Friday, 8 to 5
 * Eastern", "M-F 8-5", "weekdays 9am to 6pm") into the structured
 * weeklyHours shape used by availability ({ day, start, end } with day
 * 0=Sunday..6=Saturday, HH:MM 24h times) WITHOUT changing its semantic
 * meaning. No AI. If the text does not match a pattern this parser is
 * certain about, it returns null — the caller must then treat the answer as
 * unparsed verbatim owner input, NEVER silently substitute a default.
 *
 * Deliberately conservative: one day-range + one time-range (the dominant
 * small-business phrasing). Multi-segment schedules ("Mon 8-5, Sat 9-12")
 * return null and stay verbatim.
 */

const DAY_ALIASES = {
  sunday: 0, sun: 0, su: 0,
  monday: 1, mon: 1, mo: 1, m: 1,
  tuesday: 2, tues: 2, tue: 2, tu: 2,
  wednesday: 3, wed: 3, we: 3, w: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, th: 4,
  friday: 5, fri: 5, fr: 5, f: 5,
  saturday: 6, sat: 6, sa: 6,
};

const WEEKDAY_WORDS = /\b(weekdays?|business\s+days?|monday\s*(?:through|thru|to|-|–|—)\s*friday|mon\s*(?:through|thru|to|-|–|—)\s*fri|m\s*(?:-|–|—|to|thru|through)\s*f)\b/i;

/** Parse a single clock token like "8", "8am", "8:30", "17", "5 pm" → minutes-from-midnight or null. */
function parseClock(raw, meridiem) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour >= 1 && hour <= 11) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function fmt(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Extract the single time range. Accepts "8 to 5", "8-5", "8:30am-5:00pm",
 * "from 9 until 6pm". Meridiem inference when absent: businesses open in the
 * morning and close in the afternoon — if end <= start and both were given
 * without am/pm, the end is treated as pm (8-5 → 08:00-17:00). That is the
 * conventional reading, not a semantic change.
 */
function parseTimeRange(text) {
  const re = /(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:to|until|till|thru|through|-|–|—)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?/i;
  const m = re.exec(text);
  if (!m) return null;
  const norm = (s) => (s ? s.toLowerCase().replace(/\./g, "") : null);
  const startMer = norm(m[2]);
  const endMer = norm(m[4]);
  let start = parseClock(m[1], startMer);
  let end = parseClock(m[3], endMer);
  if (start == null || end == null) return null;
  if (end <= start) {
    if (!endMer && end / 60 <= 11) end += 12 * 60; // 8-5 → 8:00-17:00
    else return null; // explicit but inverted — refuse rather than guess
  }
  if (end <= start) return null;
  return { start: fmt(start), end: fmt(end) };
}

/** Extract the day set. Returns array of day numbers or null when unsure. */
function parseDays(text) {
  if (WEEKDAY_WORDS.test(text)) return [1, 2, 3, 4, 5];
  if (/\b(every\s*day|everyday|7\s*days|daily)\b/i.test(text)) return [0, 1, 2, 3, 4, 5, 6];
  // Explicit "X through Y" day range with full/abbrev day names.
  const re = /\b([a-z]{1,9})\s*(?:through|thru|to|-|–|—)\s*([a-z]{1,9})\b/i;
  const m = re.exec(text);
  if (m) {
    const a = DAY_ALIASES[m[1].toLowerCase()];
    const b = DAY_ALIASES[m[2].toLowerCase()];
    if (a != null && b != null) {
      const days = [];
      let d = a;
      for (let i = 0; i < 7; i += 1) {
        days.push(d);
        if (d === b) return days;
        d = (d + 1) % 7;
      }
    }
  }
  return null;
}

/**
 * Parse verbatim owner hours text.
 * Returns { weeklyHours: [{ day, start, end }] } or null when not certain.
 * The time-zone word (e.g. "Eastern") is ignored here — timezone is a
 * separate interview answer; stripping it does not change the hours.
 */
function parseBusinessHours(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "" || text.length > 200) return null;
  // Multi-segment schedules (two or more separate time ranges) → not certain.
  const ranges = text.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s*(?:to|until|till|thru|through|-|–|—)\s*\d{1,2}(?::\d{2})?/gi);
  if (!ranges || ranges.length !== 1) return null;
  const time = parseTimeRange(text);
  if (!time) return null;
  // Day set: explicit words win; a bare time range ("8 to 5") defaults to
  // weekdays only when NO day words appear at all (the interview asks for
  // weekday business hours; bare range = weekday answer).
  let days = parseDays(text);
  if (days == null) {
    const mentionsDay = Object.keys(DAY_ALIASES).some((d) =>
      d.length >= 3 && new RegExp(`\\b${d}\\b`, "i").test(text),
    );
    if (mentionsDay) return null; // day words we couldn't resolve — refuse
    days = [1, 2, 3, 4, 5];
  }
  if (days.length === 0) return null;
  return { weeklyHours: days.map((day) => ({ day, start: time.start, end: time.end })) };
}

module.exports = { parseBusinessHours, _parseTimeRange: parseTimeRange, _parseDays: parseDays };
