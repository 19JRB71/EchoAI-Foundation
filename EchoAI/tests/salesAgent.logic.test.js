// The Sales Agent finalizes each call by turning the AI's parsed summary into two
// stored fields that the whole admin UI + performance metrics hang on: the final
// `outcome` and a 1-10 `interest_score`. That derivation must degrade sensibly
// when the model returns nothing usable (a real conversation is "interested", an
// abandoned call is "not_interested") and must never let a bogus score escape the
// 1-10 range. We also pin the two serializers (config + call) since the client
// reads those exact camelCase shapes.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");

let deriveOutcome;
let clampInterest;
let serializeConfig;
let serializeCall;

before(() => {
  const mod = require("../controllers/salesAgentController");
  deriveOutcome = mod.deriveOutcome;
  clampInterest = mod.clampInterest;
  serializeConfig = mod.serializeConfig;
  serializeCall = mod.serializeCall;
});

test("deriveOutcome honors a valid AI outcome", () => {
  assert.equal(deriveOutcome({ outcome: "booked_demo" }, true), "booked_demo");
});

test("deriveOutcome ignores an invalid AI outcome and falls back", () => {
  assert.equal(deriveOutcome({ outcome: "nonsense" }, true), "interested");
});

test("deriveOutcome with no parse: conversation → interested", () => {
  assert.equal(deriveOutcome(null, true), "interested");
});

test("deriveOutcome with no parse + no conversation → not_interested", () => {
  assert.equal(deriveOutcome(null, false), "not_interested");
});

test("clampInterest uses a valid parsed score", () => {
  assert.equal(clampInterest({ interest_score: 8 }, 3), 8);
});

test("clampInterest clamps above 10 and below 1", () => {
  assert.equal(clampInterest({ interest_score: 42 }, 3), 10);
  assert.equal(clampInterest({ interest_score: 0 }, 3), 1);
});

test("clampInterest falls back to the running score when unparseable", () => {
  assert.equal(clampInterest(null, 5), 5);
  assert.equal(clampInterest({ interest_score: "high" }, 4), 4);
  assert.equal(clampInterest(null, undefined), 0);
});

test("serializeConfig exposes camelCase + defaults, never raw tokens", () => {
  const out = serializeConfig({
    owner_phone: "+15551234567",
    hey_echo_mode: "voice",
    booking_link: "https://x.co/demo",
    objections: [{ objection: "price", response: "worth it" }],
    enabled: true,
  });
  assert.equal(out.ownerPhone, "+15551234567");
  assert.equal(out.heyEchoMode, "voice");
  assert.equal(out.bookingLink, "https://x.co/demo");
  assert.equal(out.enabled, true);
  assert.deepEqual(out.objections, [{ objection: "price", response: "worth it" }]);
  assert.equal(typeof out.twilioConfigured, "boolean");
  assert.ok(!("owner_phone" in out));
});

test("serializeConfig defaults a null/blank row to safe values", () => {
  const out = serializeConfig({});
  assert.equal(out.ownerPhone, "");
  assert.equal(out.heyEchoMode, "sms");
  assert.equal(out.bookingLink, "");
  assert.deepEqual(out.objections, []);
  assert.equal(out.enabled, true); // enabled defaults on unless explicitly false
});

test("serializeConfig treats enabled === false as disabled", () => {
  assert.equal(serializeConfig({ enabled: false }).enabled, false);
});

test("serializeCall maps snake_case row → camelCase + counts turns", () => {
  const out = serializeCall({
    call_id: "abc",
    prospect_phone: "+15550001111",
    prospect_name: "Dana",
    business_type: "Dental",
    interest_score: 7,
    outcome: "interested",
    call_duration: 125,
    summary: "went well",
    booked_demo: false,
    follow_up_scheduled: false,
    invite_sent: true,
    status: "completed",
    conversation_history: [{ role: "assistant" }, { role: "user" }],
  });
  assert.equal(out.callId, "abc");
  assert.equal(out.prospectName, "Dana");
  assert.equal(out.interestScore, 7);
  assert.equal(out.callDuration, 125);
  assert.equal(out.inviteSent, true);
  assert.equal(out.turns, 2);
});

test("serializeCall tolerates a missing transcript (turns = 0)", () => {
  assert.equal(serializeCall({ call_id: "x" }).turns, 0);
});
