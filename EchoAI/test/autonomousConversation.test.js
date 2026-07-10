const test = require("node:test");
const assert = require("node:assert");

const {
  parseDecision,
  directiveForPrompt,
  VALID_STATES,
  VALID_TEMPERATURES,
} = require("../utils/autonomousConversationBrain");
const {
  transferOfferText,
  closeReasonForState,
} = require("../controllers/autonomousConversationController");

// ---------------------------------------------------------------------------
// Hermes decision parsing (network-free — parseDecision is pure)
// ---------------------------------------------------------------------------

test("parseDecision reads a plain JSON decision", () => {
  const d = parseDecision(
    JSON.stringify({
      intent: "pricing question",
      state: "continue",
      buyingSignal: true,
      temperature: "hot",
      directive: "Answer the price and offer a call.",
    }),
  );
  assert.strictEqual(d.intent, "pricing question");
  assert.strictEqual(d.state, "continue");
  assert.strictEqual(d.buyingSignal, true);
  assert.strictEqual(d.temperature, "hot");
  assert.strictEqual(d.directive, "Answer the price and offer a call.");
});

test("parseDecision strips a ```json fenced block", () => {
  const raw =
    "Here you go:\n```json\n" +
    JSON.stringify({ intent: "greeting", state: "booked" }) +
    "\n```\nthanks";
  const d = parseDecision(raw);
  assert.strictEqual(d.intent, "greeting");
  assert.strictEqual(d.state, "booked");
});

test("parseDecision coerces an unknown state to 'continue' and bad temp to null", () => {
  const d = parseDecision(
    JSON.stringify({ state: "banana", temperature: "lukewarm" }),
  );
  assert.strictEqual(d.state, "continue");
  assert.strictEqual(d.temperature, null);
  // Every valid state/temperature the parser accepts is a known enum value.
  assert.ok(VALID_STATES.has(d.state));
});

test("parseDecision defaults buyingSignal to false unless strictly true", () => {
  assert.strictEqual(parseDecision(JSON.stringify({ buyingSignal: "yes" })).buyingSignal, false);
  assert.strictEqual(parseDecision(JSON.stringify({ buyingSignal: 1 })).buyingSignal, false);
  assert.strictEqual(parseDecision(JSON.stringify({ buyingSignal: true })).buyingSignal, true);
});

test("parseDecision returns null for non-JSON / empty input", () => {
  assert.strictEqual(parseDecision("no json here"), null);
  assert.strictEqual(parseDecision(""), null);
  assert.strictEqual(parseDecision(null), null);
  assert.strictEqual(parseDecision("{ not valid json"), null);
});

test("VALID_TEMPERATURES contains the temperature scale", () => {
  assert.ok(VALID_TEMPERATURES.has("hot"));
  assert.ok(VALID_TEMPERATURES.has("warm"));
  assert.ok(VALID_TEMPERATURES.has("tire_kicker"));
});

// ---------------------------------------------------------------------------
// Reply-prompt directive
// ---------------------------------------------------------------------------

test("directiveForPrompt is empty without a usable decision", () => {
  assert.strictEqual(directiveForPrompt(null), "");
  assert.strictEqual(directiveForPrompt({}), "");
  assert.strictEqual(directiveForPrompt({ directive: "" }), "");
});

test("directiveForPrompt injects the intent and directive when present", () => {
  const line = directiveForPrompt({
    intent: "ready to buy",
    directive: "Offer to book a call today.",
  });
  assert.match(line, /ready to buy/);
  assert.match(line, /Offer to book a call today\./);
  assert.match(line, /Hermes/);
});

// ---------------------------------------------------------------------------
// Owner-escalation offer text (exact task wording)
// ---------------------------------------------------------------------------

test("transferOfferText addresses the owner and offers transfer-or-continue", () => {
  const t = transferOfferText("Acme Co");
  assert.match(t, /^Sir,/);
  assert.match(t, /live conversation with a hot lead/);
  assert.match(t, /for Acme Co/);
  assert.match(t, /transfer them to you, or keep handling it\?/);
});

test("transferOfferText omits the brand clause when no brand name", () => {
  const t = transferOfferText();
  assert.doesNotMatch(t, / for /);
  assert.match(t, /transfer them to you, or keep handling it\?/);
});

// ---------------------------------------------------------------------------
// Terminal close-reason mapping
// ---------------------------------------------------------------------------

test("closeReasonForState maps terminal states and continues otherwise", () => {
  assert.strictEqual(closeReasonForState("booked"), "booked");
  assert.strictEqual(closeReasonForState("converted"), "converted");
  assert.strictEqual(closeReasonForState("stop"), "stopped");
  assert.strictEqual(closeReasonForState("continue"), null);
  assert.strictEqual(closeReasonForState("anything-else"), null);
});

test("closeReasonForState treats a booked hint as authoritative", () => {
  assert.strictEqual(closeReasonForState("continue", true), "booked");
  assert.strictEqual(closeReasonForState("stop", true), "booked");
});

// ---------------------------------------------------------------------------
// Engine regressions (db.query swapped with in-memory fakes; no network).
// These lock in two handoff invariants:
//   1. Once the owner has TRANSFERRED a conversation, Echo stays silent — it
//      must NOT run Hermes/Claude or create a fresh active thread.
//   2. The hot-lead owner escalation fires AT MOST ONCE, gated by an atomic
//      compare-and-set on owner_alerted_at (concurrent buying-signal turns
//      can't both alert the owner).
// ---------------------------------------------------------------------------

const db = require("../config/db");
const brain = require("../utils/autonomousConversationBrain");
const controller = require("../controllers/autonomousConversationController");

test("handleInboundReply stays silent when the owner has taken over (transferred)", async () => {
  const origQuery = db.query;
  const origAnalyze = brain.analyzeReply;
  let analyzeCalled = false;
  brain.analyzeReply = async () => {
    analyzeCalled = true;
    return null;
  };
  db.query = async (sql) => {
    if (/SELECT \* FROM autonomous_conversations/i.test(sql)) {
      return {
        rows: [
          { conversation_id: "c1", status: "transferred", transcript: [], owner_alerted_at: null, channel: "sms" },
        ],
      };
    }
    throw new Error("no query should run after a transferred short-circuit: " + sql);
  };
  try {
    const res = await controller.handleInboundReply({
      brand: { brand_id: "b1", brand_name: "Acme" },
      ownerUserId: "u1",
      lead: { lead_id: "l1", conversation_history: [], temperature: "warm" },
      channel: "sms",
      inboundText: "still interested, can we talk?",
    });
    assert.strictEqual(res.transferred, true);
    assert.strictEqual(res.reply, null);
    assert.strictEqual(analyzeCalled, false, "Hermes must not run once the owner has taken over");
  } finally {
    db.query = origQuery;
    brain.analyzeReply = origAnalyze;
  }
});

test("owner escalation fires at most once via the atomic owner_alerted_at claim", async () => {
  const origQuery = db.query;
  const origAnalyze = brain.analyzeReply;
  brain.analyzeReply = async () => ({
    intent: "pricing",
    state: "continue",
    buyingSignal: true,
    temperature: "hot",
    directive: "",
  });
  const store = { alerted: null };
  let claimWins = 0;
  db.query = async (sql) => {
    if (/SELECT \* FROM autonomous_conversations/i.test(sql)) {
      return {
        rows: [
          { conversation_id: "c1", status: "active", transcript: [], owner_alerted_at: store.alerted, channel: "sms" },
        ],
      };
    }
    // Atomic escalation claim (checked BEFORE the generic UPDATE match).
    if (/UPDATE autonomous_conversations[\s\S]*owner_alerted_at = NOW\(\)[\s\S]*owner_alerted_at IS NULL/i.test(sql)) {
      if (store.alerted === null) {
        store.alerted = new Date();
        claimWins += 1;
        return { rows: [{ conversation_id: "c1" }] };
      }
      return { rows: [] };
    }
    if (/UPDATE autonomous_conversations/i.test(sql)) {
      return { rows: [{ conversation_id: "c1", status: "active" }] };
    }
    if (/UPDATE leads/i.test(sql)) return { rows: [] };
    // escalateToOwner owner/twilio lookup + any best-effort voice writes:
    // no owner phone → SMS is skipped; voice enqueue is wrapped in try/catch.
    return { rows: [{ owner_phone: null }] };
  };
  try {
    const args = {
      brand: { brand_id: "b1", brand_name: "Acme" },
      ownerUserId: "u1",
      lead: { lead_id: "l1", conversation_history: [], temperature: "warm" },
      channel: "sms",
      inboundText: "I want to buy right now",
      existingReply: "Wonderful — here's how we get started.",
    };
    await controller.handleInboundReply(args);
    await controller.handleInboundReply(args);
    assert.strictEqual(claimWins, 1, "the escalation claim must win exactly once across turns");
  } finally {
    db.query = origQuery;
    brain.analyzeReply = origAnalyze;
  }
});
