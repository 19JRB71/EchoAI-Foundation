const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const reminders = require("../utils/echoVoiceReminders");

// ---------------------------------------------------------------------------
// Per-item guard regressions for the every-minute reminder sweep. Mirrors the
// makeGoalSweepDb-style fakes in goals.test.js: a throw while processing item 1
// must be contained by the per-item guard so item 2 is still processed.
// ---------------------------------------------------------------------------

/**
 * In-memory stand-in for db.query covering the reminder sweep's queries:
 * the appointment window scan, the due-touchpoint scan, and the voice
 * notification enqueue INSERT (recorded so tests can assert what landed).
 */
function makeReminderSweepDb(seed) {
  const state = { voiceInserts: [] };

  async function query(sql, params = []) {
    if (/FROM appointments a/i.test(sql)) {
      return { rows: (seed.appointments || []).map((r) => ({ ...r })) };
    }
    if (/FROM sequence_touchpoints t/i.test(sql) && /channel = 'phone'/i.test(sql)) {
      return { rows: (seed.touchpoints || []).map((r) => ({ ...r })) };
    }
    if (/INSERT INTO echo_voice_notifications/i.test(sql)) {
      // Column order in the real INSERT: user_id, brand_id, event_type, title,
      // spoken_text, payload, dedup_key, deliver_after, expires_at.
      state.voiceInserts.push({
        userId: params[0],
        brandId: params[1],
        eventType: params[2],
        title: params[3],
        dedupKey: params[6],
      });
      return { rows: [{ notification_id: `n${state.voiceInserts.length}` }] };
    }
    throw new Error(`makeReminderSweepDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

function inMinutes(mins) {
  return new Date(Date.now() + mins * 60000).toISOString();
}

test("sweepAppointmentReminders: a throw for appointment 1 never silences appointment 2", async () => {
  const fake = makeReminderSweepDb({
    appointments: [
      {
        appointment_id: "a1",
        title: "Broken",
        start_time: inMinutes(10),
        contact_name: "Alice",
        contact_phone: null,
        description: null,
        location: null,
        user_id: "u1",
        brand_id: "b1",
        lead_name: null,
        lead_phone: null,
        first_name: "Owner",
        voice_settings: null,
      },
      {
        appointment_id: "a2",
        title: "Fine",
        start_time: inMinutes(10),
        contact_name: "Bob",
        contact_phone: null,
        description: null,
        location: null,
        user_id: "u1",
        brand_id: "b1",
        lead_name: null,
        lead_phone: null,
        first_name: "Owner",
        voice_settings: null,
      },
    ],
  });

  const origQuery = db.query;
  const origProcess = reminders.processAppointmentReminderRow;
  db.query = fake.query;
  reminders.processAppointmentReminderRow = async (r) => {
    if (r.appointment_id === "a1") {
      // Simulates a malformed row blowing up the per-appointment body.
      throw new Error("malformed appointment row");
    }
    return origProcess(r);
  };

  try {
    const scanned = await reminders.sweepAppointmentReminders();
    assert.strictEqual(scanned, 2, "both rows must be scanned");

    // a2 (the NEXT appointment after the malformed one) still enqueued its
    // 15-minute reminder; nothing referencing a1 ever landed.
    assert.deepStrictEqual(
      fake.state.voiceInserts.map((v) => v.dedupKey),
      ["appt15:a2"],
      "appointment 2 must still be reminded after appointment 1's throw",
    );
  } finally {
    db.query = origQuery;
    reminders.processAppointmentReminderRow = origProcess;
  }
});

test("sweepFollowUpReminders: a throw for touchpoint 1 never silences touchpoint 2", async () => {
  const fake = makeReminderSweepDb({
    touchpoints: [
      {
        touchpoint_id: "t1",
        scheduled_at: new Date().toISOString(),
        brand_id: "b1",
        user_id: "u1",
        first_name: "Owner",
        voice_settings: null,
        lead_name: "Bad Lead",
        temperature: "hot",
        lead_updated_at: null,
        phone: null,
      },
      {
        touchpoint_id: "t2",
        scheduled_at: new Date().toISOString(),
        brand_id: "b1",
        user_id: "u1",
        first_name: "Owner",
        voice_settings: null,
        lead_name: "Good Lead",
        temperature: "warm",
        lead_updated_at: null,
        phone: null,
      },
    ],
  });

  const origQuery = db.query;
  const origProcess = reminders.processFollowUpReminderRow;
  db.query = fake.query;
  reminders.processFollowUpReminderRow = async (r) => {
    if (r.touchpoint_id === "t1") {
      throw new Error("malformed touchpoint row");
    }
    return origProcess(r);
  };

  try {
    const scanned = await reminders.sweepFollowUpReminders();
    assert.strictEqual(scanned, 2, "both rows must be scanned");

    assert.deepStrictEqual(
      fake.state.voiceInserts.map((v) => v.dedupKey),
      ["followup:t2"],
      "touchpoint 2 must still be reminded after touchpoint 1's throw",
    );
  } finally {
    db.query = origQuery;
    reminders.processFollowUpReminderRow = origProcess;
  }
});

test("sweepDueReminders: an appointment-sweep failure never silences the follow-up sweep", async () => {
  const fake = makeReminderSweepDb({
    touchpoints: [
      {
        touchpoint_id: "t9",
        scheduled_at: new Date().toISOString(),
        brand_id: "b1",
        user_id: "u1",
        first_name: "Owner",
        voice_settings: null,
        lead_name: "Lead",
        temperature: null,
        lead_updated_at: null,
        phone: null,
      },
    ],
  });

  const origQuery = db.query;
  db.query = async (sql, params) => {
    if (/FROM appointments a/i.test(sql)) {
      // The whole appointments query errors (e.g. bad column after a migration).
      throw new Error("appointments relation unavailable");
    }
    return fake.query(sql, params);
  };

  try {
    await reminders.sweepDueReminders();

    assert.deepStrictEqual(
      fake.state.voiceInserts.map((v) => v.dedupKey),
      ["followup:t9"],
      "the follow-up sweep must still run after the appointment sweep errors",
    );
  } finally {
    db.query = origQuery;
  }
});
