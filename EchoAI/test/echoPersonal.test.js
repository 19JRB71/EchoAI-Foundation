const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const personal = require("../utils/echoPersonal");

// ---------------------------------------------------------------------------
// Per-item guard regressions for the personal reminder sweeps (mirrors the
// makeReminderSweepDb pattern in echoVoiceReminders.test.js): a throw while
// processing row 1 must never silence row 2.
// ---------------------------------------------------------------------------

function makePersonalSweepDb(seed) {
  const state = { claims: [], settles: [] };

  async function query(sql, params = []) {
    if (/FROM echo_reminders r/i.test(sql) && /status = 'scheduled'/i.test(sql)) {
      return { rows: (seed.due || []).map((r) => ({ ...r })) };
    }
    if (/FROM echo_reminders r/i.test(sql) && /status = 'notifying'/i.test(sql)) {
      return { rows: (seed.notifying || []).map((r) => ({ ...r })) };
    }
    if (/UPDATE echo_reminders/i.test(sql) && /SET status = 'notifying'/i.test(sql)) {
      state.claims.push(params[0]);
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE echo_reminders/i.test(sql)) {
      state.settles.push({ id: params[0], params });
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE echo_voice_notifications/i.test(sql)) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`makePersonalSweepDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("sweepDueEchoReminders: a throw for reminder 1 never silences reminder 2", async () => {
  const fake = makePersonalSweepDb({
    due: [
      { reminder_id: "r1", user_id: "u1", reminder_text: "Broken", due_at: new Date().toISOString(), recurrence: "none" },
      { reminder_id: "r2", user_id: "u1", reminder_text: "Fine", due_at: new Date().toISOString(), recurrence: "none" },
    ],
  });
  const origQuery = db.query;
  const origRow = personal.processDueReminderRow;
  db.query = fake.query;
  personal.processDueReminderRow = async (r) => {
    if (r.reminder_id === "r1") throw new Error("boom");
    return origRow(r);
  };
  try {
    const n = await personal.sweepDueEchoReminders();
    assert.equal(n, 2);
    // r2 was still claimed despite r1 throwing.
    assert.deepEqual(fake.state.claims, ["r2"]);
  } finally {
    db.query = origQuery;
    personal.processDueReminderRow = origRow;
  }
});

test("sweepReminderFallbacks: a throw for row 1 never silences row 2", async () => {
  const fake = makePersonalSweepDb({
    notifying: [
      { reminder_id: "r1", notification_status: "delivered", recurrence: "none" },
      { reminder_id: "r2", notification_status: "delivered", recurrence: "none" },
    ],
  });
  const origQuery = db.query;
  const origRow = personal.processReminderFallbackRow;
  db.query = fake.query;
  personal.processReminderFallbackRow = async (r) => {
    if (r.reminder_id === "r1") throw new Error("boom");
    return origRow(r);
  };
  try {
    const n = await personal.sweepReminderFallbacks();
    assert.equal(n, 2);
    assert.equal(fake.state.settles.length, 1);
    assert.equal(fake.state.settles[0].id, "r2");
  } finally {
    db.query = origQuery;
    personal.processReminderFallbackRow = origRow;
  }
});

// ---------------------------------------------------------------------------
// Recurrence math: next occurrence is always in the future, even when the
// reminder was overdue by several periods.
// ---------------------------------------------------------------------------

test("nextOccurrence: daily reminder overdue by 3 days catches up past now", () => {
  const now = new Date("2026-07-09T12:00:00Z");
  const due = new Date("2026-07-06T09:00:00Z");
  const next = personal.nextOccurrence(due, "daily", now);
  assert.ok(next > now);
  assert.equal(next.toISOString(), "2026-07-10T09:00:00.000Z");
});

test("nextOccurrence: weekly steps exactly one week when not overdue", () => {
  const now = new Date("2026-07-09T12:00:00Z");
  const due = new Date("2026-07-09T15:00:00Z");
  const next = personal.nextOccurrence(due, "weekly", now);
  assert.equal(next.toISOString(), "2026-07-16T15:00:00.000Z");
});
