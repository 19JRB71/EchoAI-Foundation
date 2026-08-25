/**
 * Prompt 035 Stage 2 — Section H: second-business entry.
 *
 * The explicit "new_business" intent starts a FRESH interview that never
 * resumes the open session, never binds the existing brand, and stores the
 * choice in the session's own answers._interview bookkeeping (a JSONB field,
 * NOT a new SQL column) — so it survives a server restart with the session
 * row alone. Default calls stay bit-for-bit the old resume-or-start path.
 * DB and AI are stubbed — this tests the controller contract.
 *
 * Run with:  node --test test/p035.secondBusiness.test.js
 */

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const controller = require("../controllers/setupAgentController");

const USER = "11111111-1111-4111-8111-111111111111";

const originals = { query: db.query, createMessage: null };
let state;
let queries;

function res() {
  const r = {
    statusCode: 200,
    body: null,
    status(c) {
      r.statusCode = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
  };
  return r;
}

beforeEach(() => {
  state = { openSessions: [], brands: [] };
  queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    if (/SELECT u.onboarding_completed/.test(sql)) return { rows: [{ onboarding_completed: true, completed_journey_count: 0 }] };
    if (/SELECT \* FROM setup_sessions/.test(sql)) return { rows: state.openSessions };
    if (/UPDATE setup_sessions SET status = 'paused'/.test(sql)) {
      state.pausedAll = true;
      return { rows: [] };
    }
    if (/INSERT INTO setup_sessions/.test(sql)) {
      state.inserted = { messages: params[1], answers: params[2], brand_id: params[5] };
      return {
        rows: [
          {
            session_id: "s-new",
            user_id: USER,
            messages: JSON.parse(params[1]),
            answers: JSON.parse(params[2]),
            current_field: params[3],
            interview_complete: false,
            consent_granted: false,
            status: "in_progress",
            brand_id: params[5],
            completed_steps: [],
          },
        ],
      };
    }
    // Anything else (knowledge inventory reads etc.) — only legal for the
    // DEFAULT path; the sparse new-business path must never get here before
    // insert. Return empty.
    return { rows: [] };
  };
  // Deterministic interview brain — the controller invokes the governed AI
  // chokepoint via its own `module.exports._createMessage` seam (exported for
  // exactly this purpose), so stubbing the export is offline and gate-free.
  originals.createMessage = controller._createMessage;
  controller._createMessage = async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          message: "What are you setting up?",
          suggestion: "",
          collects: "account_type",
          complete: false,
        }),
      },
    ],
  });
});
afterEach(() => {
  db.query = originals.query;
  controller._createMessage = originals.createMessage;
});

test("secondBusiness.entryIntent.resumeSurvivesRestart — intent persisted in answers._interview JSONB, sparse inventory, no brand bind", async () => {
  const r = res();
  await controller.initiateSession({ user: { userId: USER }, body: { intent: "new_business" } }, r);
  assert.equal(r.statusCode, 200);
  const answers = JSON.parse(state.inserted.answers);
  // Persisted in the session row itself — a restart re-reads it from answers.
  assert.equal(answers._interview.entryIntent, "new_business");
  // No brand binding: the other business's brand must never be attached.
  assert.equal(state.inserted.brand_id, null);
  // Round-trip through interviewState (the resume path's reader).
  const revived = controller.interviewState(answers);
  assert.equal(revived.entryIntent, "new_business");
});

test("new_business pauses (never deletes) an open session before starting fresh", async () => {
  state.openSessions = [{ session_id: "s-old", status: "in_progress", messages: [], answers: {} }];
  const r = res();
  await controller.initiateSession({ user: { userId: USER }, body: { intent: "new_business" } }, r);
  assert.equal(state.pausedAll, true);
  assert.ok(state.inserted, "a fresh session row was inserted");
});

test("default path resumes an open session unchanged (bit-identical legacy behavior)", async () => {
  state.openSessions = [
    {
      session_id: "s-old",
      status: "paused",
      messages: [],
      answers: {},
      completed_steps: [],
    },
  ];
  // The resume UPDATE returns the session row.
  const prevQuery = db.query;
  db.query = async (sql, params) => {
    if (/SET status = 'in_progress', resumed_at/.test(sql)) {
      return { rows: [{ ...state.openSessions[0], status: "in_progress" }] };
    }
    return prevQuery(sql, params);
  };
  const r = res();
  await controller.initiateSession({ user: { userId: USER }, body: {} }, r);
  assert.equal(r.body.resumed, true);
  assert.equal(state.inserted, undefined);
  assert.equal(state.pausedAll, undefined);
});

test("probe is read-only: reports openSession without creating or resuming anything", async () => {
  state.openSessions = [{ session_id: "s-old", status: "paused" }];
  const r = res();
  await controller.initiateSession({ user: { userId: USER }, body: { probe: true } }, r);
  assert.deepEqual(r.body, { openSession: true });
  assert.equal(state.inserted, undefined);
  assert.equal(queries.length, 2); // user-state guard + open-session SELECT
  const r2 = res();
  state.openSessions = [];
  await controller.initiateSession({ user: { userId: USER }, body: { probe: true } }, r2);
  assert.deepEqual(r2.body, { openSession: false });
});

test("interviewState rejects unknown entryIntent values (only new_business/resume survive)", () => {
  const s = controller.interviewState({ _interview: { entryIntent: "haxx" } });
  assert.equal(s.entryIntent, null);
});
