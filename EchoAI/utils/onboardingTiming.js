/**
 * Prompt 035 Stage 2 — Section L: honest onboarding timing instrumentation.
 *
 * APPEND-ONLY event log (onboarding_timing_events). NO truncation, NO
 * clamping, NO deletion — every second between signup and campaign-ready is
 * preserved and CLASSIFIED, never erased (the Stage-1 5-minute truncation
 * rule was rejected by the owner).
 *
 * DOCUMENTED ASSUMPTIONS (all thresholds disclosed in the summary payload):
 *  - The client emits: surface_shown / surface_hidden (mount + visibility),
 *    focus / blur, activity (input/pointer/keys, throttled to one per
 *    ACTIVITY_THROTTLE_S), heartbeat (every HEARTBEAT_S while visible).
 *  - surface-open  = union of [surface_shown … surface_hidden] intervals; an
 *    unterminated interval is closed at the LAST event seen for that user
 *    (crash/tab-kill safe: we never extend time we didn't observe).
 *  - focused-open  = surface-open ∩ union of [focus … blur] intervals.
 *  - input-engaged = focused-open ∩ union of ENGAGE_WINDOW_S windows opened
 *    by each activity event (an owner reading for a while between keystrokes
 *    counts as engaged only within that window).
 *  - inferred-idle = focused-open − input-engaged. It is REPORTED, not
 *    subtracted from anything silently.
 *  - system/external waits = union of [system_wait_start … system_wait_end]
 *    per wait kind (research, company_truth, oauth), reported separately.
 *  - wall-clock = users.created_at → campaign_ready milestone event.
 */

const db = require("../config/db");

const HEARTBEAT_S = 30;
const ACTIVITY_THROTTLE_S = 15;
const ENGAGE_WINDOW_S = 60;

const EVENT_KINDS = new Set([
  "surface_shown",
  "surface_hidden",
  "focus",
  "blur",
  "activity",
  "heartbeat",
  "system_wait_start",
  "system_wait_end",
  "milestone",
]);

/** Append client-reported events. Invalid kinds are rejected (400 upstream). */
async function recordEvents(userId, events) {
  if (!Array.isArray(events) || events.length === 0 || events.length > 100) {
    const err = new Error("events must be a non-empty array (max 100).");
    err.statusCode = 400;
    throw err;
  }
  for (const e of events) {
    if (!e || !EVENT_KINDS.has(e.kind)) {
      const err = new Error(`Unknown timing event kind: ${e && e.kind}`);
      err.statusCode = 400;
      throw err;
    }
  }
  const values = [];
  const params = [];
  let i = 1;
  for (const e of events) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, COALESCE($${i++}::timestamptz, NOW()), $${i++}::jsonb)`);
    params.push(
      userId,
      e.brandId || null,
      typeof e.phase === "string" ? e.phase.slice(0, 60) : "onboarding",
      e.kind,
      e.at || null,
      e.meta ? JSON.stringify(e.meta).slice(0, 2000) : null,
    );
  }
  await db.query(
    `INSERT INTO onboarding_timing_events (user_id, brand_id, phase, event_kind, at, meta)
     VALUES ${values.join(", ")}`,
    params,
  );
  return events.length;
}

/** Server-side system-wait bookkeeping (research / CT generation / oauth). */
function recordSystemWait(userId, brandId, waitKind, edge, meta) {
  const kind = edge === "start" ? "system_wait_start" : "system_wait_end";
  return db
    .query(
      `INSERT INTO onboarding_timing_events (user_id, brand_id, phase, event_kind, meta)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, brandId || null, "onboarding", kind, JSON.stringify({ waitKind, ...(meta || {}) })],
    )
    .catch((e) => console.error("timing recordSystemWait failed:", e.message));
}

/** Record the campaign_ready milestone exactly once per brand. */
async function recordMilestoneOnce(userId, brandId, name) {
  const { rows } = await db.query(
    `SELECT 1 FROM onboarding_timing_events
      WHERE user_id = $1 AND event_kind = 'milestone' AND meta->>'name' = $2
        AND (brand_id = $3 OR ($3::uuid IS NULL AND brand_id IS NULL)) LIMIT 1`,
    [userId, name, brandId || null],
  );
  if (rows.length) return false;
  await db.query(
    `INSERT INTO onboarding_timing_events (user_id, brand_id, phase, event_kind, meta)
     VALUES ($1, $2, 'onboarding', 'milestone', $3::jsonb)`,
    [userId, brandId || null, JSON.stringify({ name })],
  );
  return true;
}

// --- interval math -----------------------------------------------------

/** Merge [start,end] ms intervals (sorted or not) into a disjoint union. */
function mergeIntervals(intervals) {
  const list = intervals.filter((iv) => iv[1] > iv[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of list) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

function intersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return out;
}

function subtract(a, b) {
  let current = a.map((iv) => [...iv]);
  for (const cut of b) {
    const next = [];
    for (const iv of current) {
      if (cut[1] <= iv[0] || cut[0] >= iv[1]) {
        next.push(iv);
        continue;
      }
      if (cut[0] > iv[0]) next.push([iv[0], cut[0]]);
      if (cut[1] < iv[1]) next.push([cut[1], iv[1]]);
    }
    current = next;
  }
  return current;
}

function totalMs(intervals) {
  return intervals.reduce((s, iv) => s + (iv[1] - iv[0]), 0);
}

/** Pair start/end kinds into intervals; unterminated closes at lastSeen. */
function pairIntervals(events, startKind, endKind, lastSeen, matchMeta) {
  const out = [];
  let open = null;
  for (const e of events) {
    if (e.event_kind === startKind && (!matchMeta || matchMeta(e))) {
      if (open == null) open = e.t;
    } else if (e.event_kind === endKind && (!matchMeta || matchMeta(e))) {
      if (open != null) {
        out.push([open, e.t]);
        open = null;
      }
    }
  }
  if (open != null && lastSeen > open) out.push([open, lastSeen]);
  return out;
}

/**
 * Compute the Section-L summary for a user: the FOUR figures (never
 * truncated) + separated system/external waits + wall-clock, with every
 * threshold assumption disclosed in the payload.
 */
async function computeSummary(userId) {
  const { rows } = await db.query(
    `SELECT event_kind, at, meta FROM onboarding_timing_events
      WHERE user_id = $1 ORDER BY at ASC`,
    [userId],
  );
  const events = rows.map((r) => ({ ...r, t: new Date(r.at).getTime() }));
  const lastSeen = events.length ? events[events.length - 1].t : 0;

  const surfaceOpen = mergeIntervals(pairIntervals(events, "surface_shown", "surface_hidden", lastSeen));
  const focusRaw = mergeIntervals(pairIntervals(events, "focus", "blur", lastSeen));
  const focusedOpen = intersect(surfaceOpen, focusRaw);
  const engageWindows = mergeIntervals(
    events
      .filter((e) => e.event_kind === "activity")
      .map((e) => [e.t, e.t + ENGAGE_WINDOW_S * 1000]),
  );
  const inputEngaged = intersect(focusedOpen, engageWindows);
  const inferredIdle = subtract(focusedOpen, inputEngaged);

  const waits = {};
  for (const kind of ["research", "company_truth", "oauth"]) {
    const m = (e) => e.meta && e.meta.waitKind === kind;
    waits[kind + "Ms"] = totalMs(
      mergeIntervals(pairIntervals(events, "system_wait_start", "system_wait_end", lastSeen, m)),
    );
  }

  const userQ = await db.query("SELECT created_at FROM users WHERE user_id = $1", [userId]);
  const milestone = events.find(
    (e) => e.event_kind === "milestone" && e.meta && e.meta.name === "campaign_ready",
  );
  const signupAt = userQ.rows[0] ? new Date(userQ.rows[0].created_at).getTime() : null;

  return {
    surfaceOpenMs: totalMs(surfaceOpen),
    focusedOpenMs: totalMs(focusedOpen),
    inputEngagedMs: totalMs(inputEngaged),
    inferredIdleMs: totalMs(inferredIdle),
    systemWaits: waits,
    wallClockMs: milestone && signupAt != null ? milestone.t - signupAt : null,
    campaignReadyAt: milestone ? new Date(milestone.t).toISOString() : null,
    eventCount: events.length,
    assumptions: {
      heartbeatSeconds: HEARTBEAT_S,
      activityThrottleSeconds: ACTIVITY_THROTTLE_S,
      engagementWindowSeconds: ENGAGE_WINDOW_S,
      unterminatedIntervalRule: "closed at the user's last observed event — unobserved time is never extended",
      truncation: "none — idle time is classified and reported, never truncated or erased",
    },
  };
}

module.exports = {
  recordEvents,
  recordSystemWait,
  recordMilestoneOnce,
  computeSummary,
  EVENT_KINDS,
  HEARTBEAT_S,
  ACTIVITY_THROTTLE_S,
  ENGAGE_WINDOW_S,
  _mergeIntervals: mergeIntervals,
  _intersect: intersect,
  _subtract: subtract,
  _pairIntervals: pairIntervals,
};
