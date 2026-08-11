// Registry validation (Prompt 025, Section A) — fail-closed, both directions.
//
// The expected inventory is DERIVED from the tree at test time (agentsController
// roster, scheduler registrations, migration task vocabulary, Hermes) — never a
// hand-maintained second roster. A runtime entity missing from the registry
// fails; a registry entry with no tree counterpart fails unless historical/dark.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const registryMod = require("../config/agentRegistry");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ---- Derive expected inventory from the tree (independent derivation) -----

function derivedAgentIds() {
  const src = read("controllers/agentsController.js");
  const start = src.indexOf("const AGENTS = [");
  assert.ok(start >= 0, "AGENTS roster must exist in agentsController.js");
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/id:\s*"([a-z_-]+)"/g)].map((m) => m[1]);
}

function derivedJobNames() {
  const src = read("utils/scheduler.js");
  return [...src.matchAll(/scheduleJob\(\s*\{\s*name:\s*"([a-z0-9_-]+)"/g)].map((m) => m[1]);
}

function derivedTaskTypes() {
  const types = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, "models"))) {
    if (!/^13[123]_/.test(f)) continue;
    const src = read(path.join("models", f));
    for (const m of src.matchAll(/task_type\s+(?:TEXT\s+NOT\s+NULL\s+)?CHECK\s*\(task_type IN \(([^)]+)\)/gi)) {
      for (const t of m[1].matchAll(/'([a-z_]+)'/g)) types.add(t[1]);
    }
    // ALTER-style additions in 132/133
    for (const m of src.matchAll(/'(ad_launch|email_send|social_publish|reconciliation)'/g)) types.add(m[1]);
  }
  return [...types].sort();
}

function fullRegistry() {
  const jobs = derivedJobNames().map((name) => ({ name }));
  return registryMod.buildRegistry(jobs);
}

// ---- Completeness: both directions ----------------------------------------

test("every named agent identity in the tree has exactly one registry entry", () => {
  const ids = derivedAgentIds();
  assert.ok(ids.length > 0, "derived roster must be non-empty");
  const regIds = registryMod.AGENT_ENTRIES.map((e) => e.id);
  for (const id of ids) assert.ok(regIds.includes(id), `agent "${id}" missing from registry`);
  for (const id of regIds) assert.ok(ids.includes(id), `registry agent "${id}" has no tree counterpart`);
  assert.strictEqual(new Set(regIds).size, regIds.length, "duplicate agent entries");
});

test("every scheduled job in the tree has registry metadata, and vice versa (fail closed)", () => {
  const names = derivedJobNames();
  assert.ok(names.length > 0, "derived job list must be non-empty");
  for (const n of names) {
    assert.ok(registryMod.JOB_META[n], `scheduled job "${n}" has no registry metadata`);
  }
  for (const n of Object.keys(registryMod.JOB_META)) {
    assert.ok(names.includes(n), `registry documents job "${n}" that no longer exists in the tree`);
  }
});

test("an undocumented scheduled job fails registry construction (fail closed)", () => {
  assert.throws(
    () => registryMod.buildAutomationEntries([{ name: "job-that-does-not-exist" }]),
    /no registry metadata/,
  );
});

test("Hermes is registered as its own decision_brain class, not a specialist agent", () => {
  assert.deepStrictEqual(registryMod.HERMES_ENTRY.roleClasses, ["decision_brain"]);
  assert.ok(!registryMod.AGENT_ENTRIES.some((e) => e.id === "hermes"));
});

test("task-type vocabulary derived from migrations 131/132/133 is covered", () => {
  const types = derivedTaskTypes();
  for (const t of ["social_publish", "reconciliation", "ad_launch", "email_send"]) {
    assert.ok(types.includes(t), `expected task type ${t} derivable from migrations`);
  }
  // The spine work queues referenced by registry entries use real task types.
  for (const e of registryMod.AGENT_ENTRIES) {
    if (!e.workQueue) continue;
    const m = e.workQueue.match(/task_type='([a-z_]+)'/);
    if (m) assert.ok(types.includes(m[1]), `workQueue task type ${m[1]} not in migration vocabulary`);
  }
});

// ---- Closed vocabularies & schema validation -------------------------------

test("every registry entry uses only closed vocabularies and required fields", () => {
  const registry = fullRegistry();
  const REQUIRED = [
    "id", "displayName", "roleClasses", "status", "permittedTools",
    "prohibitedActions", "observedExecutionPaths", "triggers", "inputs",
    "outputs", "escalation", "approvalRequirements", "proofRequirements",
    "successCriteria", "discrepancies",
  ];
  for (const e of registry) {
    for (const f of REQUIRED) assert.ok(f in e, `${e.id} missing field ${f}`);
    assert.ok(registryMod.STATUSES.includes(e.status), `${e.id} bad status ${e.status}`);
    for (const rc of e.roleClasses) {
      assert.ok(registryMod.ROLE_CLASSES.includes(rc), `${e.id} bad role class ${rc}`);
    }
    for (const p of e.observedExecutionPaths) {
      assert.ok(registryMod.EXECUTION_PATH_CLASSES.includes(p), `${e.id} bad execution path ${p}`);
    }
    assert.ok(Array.isArray(e.discrepancies), `${e.id} discrepancies must be an array`);
  }
});

test("feature-only entities carry the verbatim limitation marker", () => {
  const registry = fullRegistry();
  for (const e of registry) {
    const featureOnly =
      e.observedExecutionPaths.includes("feature_only") &&
      !e.observedExecutionPaths.includes("spine_executeExternal") &&
      !e.observedExecutionPaths.includes("adapter_backed");
    if (featureOnly && e.roleClasses.includes("scheduled_automation")) {
      assert.ok(
        e.proofRequirements.includes(registryMod.FEATURE_ONLY_LIMITATION),
        `${e.id} feature-only entry must state "${registryMod.FEATURE_ONLY_LIMITATION}"`,
      );
    }
  }
});

test("ungated_ai classifications correspond to real I-42 sites in the tree (description-only)", () => {
  for (const f of registryMod.UNGATED_AI_FILES) {
    const src = read(f);
    assert.ok(
      /messages\.create|chat\.completions/.test(src),
      `${f} listed as I-42 site but has no direct provider call`,
    );
  }
});

test("registry grants no runtime authority: module exports descriptive data only", () => {
  // No entry may carry executable hooks — the registry documents; it never runs.
  for (const e of fullRegistry()) {
    for (const v of Object.values(e)) {
      assert.notStrictEqual(typeof v, "function", `${e.id} carries executable member`);
    }
  }
});

test("composition is reported by role class, never as a flat agent count", () => {
  const comp = registryMod.compositionByRoleClass(fullRegistry());
  assert.strictEqual(comp.director, 1);
  assert.strictEqual(comp.decision_brain, 1);
  assert.ok(comp.specialist_agent >= 9);
  assert.strictEqual(comp.scheduled_automation, derivedJobNames().length);
});

test("operating-model document exists and carries the governing invariants", () => {
  const doc = read("AGENT_OPERATING_MODEL.md").replace(/^>\s?/gm, "").replace(/\s+/g, " ");
  assert.ok(doc.includes("does not itself grant runtime authority"));
  assert.ok(doc.includes("Absence of proof is never proof of failure"));
  assert.ok(!/\b\d+ agents\b/.test(doc), "document must not describe composition as 'N agents'");
});
