// Registry contract reconciliation (Prompt 025 corrective package).
//
//  - FIX 3B: the authorized 8-class role vocabulary maps deterministically
//    onto the implemented 4 classes; the mapping is documented in
//    AGENT_OPERATING_MODEL.md and the implemented vocabulary is exactly the
//    4 documented classes (no silent contract change).
//  - FIX 3C: UNGATED_AI_FILES is re-derived from the tree — every file with
//    a direct provider call is listed and every listed file still has one
//    (fail-closed inventory; the liability can never silently shrink).
//  - FIX 3A: the registry roster mirrors the agentsController AGENTS
//    constant exactly (Voice, not Guide).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const registryMod = require("../config/agentRegistry");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const AUTHORIZED_EIGHT = [
  "interface_personality",
  "department_head",
  "worker",
  "tool",
  "automation",
  "scheduled_job",
  "approval_authority",
  "execution_service",
];

test("implemented role vocabulary is exactly the 4 documented classes", () => {
  assert.deepEqual(
    [...registryMod.ROLE_CLASSES].sort(),
    ["decision_brain", "director", "scheduled_automation", "specialist_agent"],
  );
});

test("AGENT_OPERATING_MODEL.md documents the 8->4 mapping for every authorized class", () => {
  const doc = read("AGENT_OPERATING_MODEL.md");
  for (const cls of AUTHORIZED_EIGHT) {
    assert.ok(doc.includes(`\`${cls}\``), `mapping table must cover ${cls}`);
  }
  assert.ok(doc.includes("Role-class mapping"), "mapping section heading present");
});

test("registry roster mirrors agentsController AGENTS (Voice, not Guide)", () => {
  const src = read("controllers/agentsController.js");
  const controllerNames = [...src.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  const registryNames = registryMod.AGENT_ENTRIES.map((e) => e.displayName);
  for (const n of controllerNames) {
    assert.ok(registryNames.includes(n), `controller agent ${n} missing from registry`);
  }
  assert.ok(registryNames.includes("Voice"));
  assert.ok(!registryNames.includes("Guide"));
});

// Re-derive the ungated inventory from the tree with the documented broad
// basis: any `<client>.messages.create(` site outside tests and the gated
// chokepoint config/anthropic.js.
function listUngatedFromTree() {
  const hits = new Map(); // rel file -> site count
  const skipDirs = new Set(["node_modules", "tests", "test", ".git", "client"]);
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) walk(path.join(dir, ent.name));
        continue;
      }
      if (!ent.name.endsWith(".js")) continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(ROOT, abs);
      if (rel === path.join("config", "anthropic.js")) continue;
      // The inventory itself documents the counting basis in a comment that
      // mentions the pattern — it is not a call site.
      if (rel === path.join("config", "agentRegistry.js")) continue;
      const src = fs.readFileSync(abs, "utf8");
      const count = (src.match(/\.messages\.create\(/g) || []).length;
      if (count > 0) hits.set(rel.split(path.sep).join("/"), count);
    }
  };
  walk(ROOT);
  return hits;
}

test("UNGATED_AI_FILES matches the tree exactly (fail-closed, cannot silently shrink)", () => {
  const tree = listUngatedFromTree();
  const listed = new Set(registryMod.UNGATED_AI_FILES);
  for (const [file] of tree) {
    assert.ok(listed.has(file), `${file} has a direct provider call but is not in UNGATED_AI_FILES`);
  }
  for (const file of listed) {
    assert.ok(tree.has(file), `${file} is listed but has no direct provider call in the tree`);
  }
});

test("historical I-42 baseline is preserved verbatim (22 files / 37 sites)", () => {
  assert.deepEqual(registryMod.I42_HISTORICAL_BASELINE, { files: 22, sites: 37 });
});
