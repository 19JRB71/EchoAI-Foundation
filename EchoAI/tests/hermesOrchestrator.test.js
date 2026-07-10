// Pins the Hermes brain chokepoint + Echo orchestrator decision parsing.
//
// Network-free: we only exercise the pure logic — transient-error
// classification (config/hermes) and the decision parser / prompt builder
// (utils/echoOrchestrator). The live Hermes call is covered by the graceful
// fallback contract: decide() must NEVER throw and returns null on any failure.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isTransientHermesError } = require("../config/hermes");
const orchestrator = require("../utils/echoOrchestrator");

test("isTransientHermesError retries transient upstream conditions only", () => {
  assert.equal(isTransientHermesError({ status: 429 }), true);
  assert.equal(isTransientHermesError({ status: 503 }), true);
  assert.equal(isTransientHermesError({ name: "AbortError" }), true);
  assert.equal(isTransientHermesError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientHermesError({ message: "fetch failed" }), true);
  // Deterministic failures must NOT be retried.
  assert.equal(isTransientHermesError({ status: 401 }), false);
  assert.equal(isTransientHermesError({ status: 400 }), false);
  assert.equal(isTransientHermesError(null), false);
});

test("parseDecision reads clean JSON", () => {
  const d = orchestrator.parseDecision(
    '{"agent":"atlas","intent":"launch_ads","onTopic":true,"brandSwitchRequested":false,"directive":"Prepare the ad campaign preview."}',
  );
  assert.equal(d.agent, "atlas");
  assert.equal(d.intent, "launch_ads");
  assert.equal(d.onTopic, true);
  assert.equal(d.brandSwitchRequested, false);
  assert.match(d.directive, /ad campaign/i);
});

test("parseDecision tolerates code fences and surrounding prose", () => {
  const raw = 'Here is my decision:\n```json\n{"agent":"pulse","intent":"report_status","directive":"Summarize new leads."}\n```';
  const d = orchestrator.parseDecision(raw);
  assert.equal(d.agent, "pulse");
  assert.equal(d.intent, "report_status");
  assert.equal(d.onTopic, true); // defaults to on-topic when omitted
});

test("parseDecision falls back to echo for an unknown agent, and null for garbage", () => {
  const d = orchestrator.parseDecision('{"agent":"wizard","intent":"x"}');
  assert.equal(d.agent, "echo");
  assert.equal(orchestrator.parseDecision("no json here"), null);
  assert.equal(orchestrator.parseDecision(""), null);
  assert.equal(orchestrator.parseDecision(null), null);
});

test("directiveForPrompt is empty without a decision and brand-locks with one", () => {
  assert.equal(orchestrator.directiveForPrompt(null, "Acme"), "");
  const line = orchestrator.directiveForPrompt(
    { agent: "nova", intent: "schedule_posts", onTopic: true, brandSwitchRequested: false, directive: "Draft this week's posts." },
    "Acme",
  );
  assert.match(line, /teammate "nova"/);
  assert.match(line, /Acme/);
  assert.match(line, /do not reference or mix in any other business/i);
  assert.match(line, /ONE focused response/);
});

test("directiveForPrompt drops the brand-lock line when a switch was requested", () => {
  const line = orchestrator.directiveForPrompt(
    { agent: "echo", intent: "switch_business", onTopic: true, brandSwitchRequested: true, directive: "Compare the two businesses." },
    "Acme",
  );
  assert.doesNotMatch(line, /do not mix in any other business/i);
});
