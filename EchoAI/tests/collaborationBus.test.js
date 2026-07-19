// Collab Stage 0 — Collaboration Bus foundation. COLLAB_BUS defaults OFF;
// tests flip it via process.env and restore after. No AI is ever called
// (Stage 0 is pure plumbing). Real DB throughout.
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const db = require("../config/db");

const bus = require("../utils/collaborationBus");
const registry = require("../config/knowledgeRegistry");

function withFlag(name, value, fn) {
  return async () => {
    const prev = process.env[name];
    process.env[name] = value;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };
}

async function createBrand(fields = {}) {
  const email = `collab-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id",
    [email],
  );
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name, is_demo) VALUES ($1, 'Collab Test Brand', $2) RETURNING brand_id",
    [u.rows[0].user_id, fields.isDemo || false],
  );
  return { userId: u.rows[0].user_id, brandId: b.rows[0].brand_id };
}

async function deleteUser(userId) {
  await db.query(
    "DELETE FROM department_messages WHERE brand_id IN (SELECT brand_id FROM brands WHERE user_id = $1)",
    [userId],
  ).catch(() => {});
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// ---------- Knowledge Registry (pure) ----------

test("registry: every topic has exactly one owner from the roster and a class", () => {
  for (const [name, def] of Object.entries(registry.TOPICS)) {
    assert.ok(registry.DEPARTMENTS.includes(def.owner), `${name} owner in roster`);
    assert.ok(["lookup", "generation"].includes(def.class), `${name} class valid`);
    assert.ok(def.request && def.response, `${name} has both schemas`);
    // Honest-empty shape: every response schema admits available/reason.
    assert.ok(def.response.available && def.response.reason, `${name} honest-empty fields`);
  }
});

test("registry: creative.request is the only generation topic in v1", () => {
  const gen = Object.entries(registry.TOPICS).filter(([, d]) => d.class === "generation");
  assert.deepStrictEqual(gen.map(([n]) => n), ["creative.request"]);
});

test("registry: schema-only payloads reject extra fields, never strip", () => {
  const def = registry.getTopic("strategy.current");
  assert.strictEqual(registry.validatePayload(def.request, { context: "x" }), null);
  assert.match(registry.validatePayload(def.request, { context: "x", extra: 1 }), /not allowed/);
  assert.match(registry.validatePayload(def.request, "nope"), /must be an object/);
});

test("registry: denylisted keys found deep, case-insensitive, substring", () => {
  assert.strictEqual(registry.findDenylistedKey({ a: { b: [{ API_Key: "x" }] } }), "API_Key");
  assert.strictEqual(registry.findDenylistedKey({ nested: { my_token_here: 1 } }), "my_token_here");
  assert.strictEqual(registry.findDenylistedKey({ safe: { fields: ["ok"] } }), null);
});

// ---------- Dark behavior ----------

test("dark: every bus entry point answers {enabled:false} and writes nothing", async () => {
  const before = await db.query("SELECT COUNT(*)::int AS n FROM department_messages");
  const r1 = await bus.sendRequest({ brandId: "00000000-0000-0000-0000-000000000000", fromDept: "forge", topic: "strategy.current", payload: {} });
  const r2 = await bus.claimRequest({ requestId: "00000000-0000-0000-0000-000000000000", dept: "sage" });
  const r3 = await bus.respondToRequest({ requestId: "00000000-0000-0000-0000-000000000000", dept: "sage", payload: {} });
  const r4 = await bus.sendReport({ brandId: "00000000-0000-0000-0000-000000000000", fromDept: "pulse", topic: "leads.outcomes", payload: {} });
  const r5 = await bus.sendAlert({ brandId: "00000000-0000-0000-0000-000000000000", fromDept: "scout", topic: "intel.competitor", payload: {} });
  const r6 = await bus.runBusMaintenance();
  const r7 = await bus.getRecentActivity({ brandId: "00000000-0000-0000-0000-000000000000" });
  for (const r of [r1, r2, r3, r4, r5, r6, r7]) {
    assert.strictEqual(r.enabled, false);
  }
  const after = await db.query("SELECT COUNT(*)::int AS n FROM department_messages");
  assert.strictEqual(after.rows[0].n, before.rows[0].n);
});

// ---------- Request lifecycle (flag on) ----------

test("request: full lifecycle send -> claim -> respond, one response only", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const sent = await bus.sendRequest({ brandId, fromDept: "forge", topic: "strategy.current", payload: { context: "creative brief" } });
    assert.strictEqual(sent.ok, true);
    assert.strictEqual(sent.deduplicated, false);
    assert.ok(sent.answerBy, "answer_by set by default");

    // Wrong department cannot claim.
    const badClaim = await bus.claimRequest({ requestId: sent.requestId, dept: "nova" });
    assert.strictEqual(badClaim.ok, false);

    const claim = await bus.claimRequest({ requestId: sent.requestId, dept: "sage" });
    assert.strictEqual(claim.ok, true);
    assert.strictEqual(claim.request.topic, "strategy.current");

    // Double-claim rejected (atomic, status-guarded).
    const reClaim = await bus.claimRequest({ requestId: sent.requestId, dept: "sage" });
    assert.strictEqual(reClaim.ok, false);

    // Only the owner may respond — even echo cannot.
    const echoResp = await bus.respondToRequest({ requestId: sent.requestId, dept: "echo", payload: { available: false, reason: "no strategy yet" } });
    assert.strictEqual(echoResp.ok, false);
    assert.match(echoResp.error, /Only sage/);

    const resp = await bus.respondToRequest({ requestId: sent.requestId, dept: "sage", payload: { available: false, reason: "No approved strategy yet." } });
    assert.strictEqual(resp.ok, true);

    // Terminal: second response rejected.
    const resp2 = await bus.respondToRequest({ requestId: sent.requestId, dept: "sage", payload: { available: false, reason: "again" } });
    assert.strictEqual(resp2.ok, false);
    assert.match(resp2.error, /already/);

    const { rows } = await db.query("SELECT status FROM department_messages WHERE message_id = $1", [sent.requestId]);
    assert.strictEqual(rows[0].status, "answered");
  } finally {
    await deleteUser(userId);
  }
}));

test("request: decline requires a reason and records it honestly", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const sent = await bus.sendRequest({ brandId, fromDept: "atlas", topic: "intel.competitor", payload: { focus: "ads" } });
    const noReason = await bus.respondToRequest({ requestId: sent.requestId, dept: "scout", decline: true });
    assert.strictEqual(noReason.ok, false);
    const declined = await bus.respondToRequest({ requestId: sent.requestId, dept: "scout", decline: true, declineReason: "No competitors confirmed for this brand yet." });
    assert.strictEqual(declined.ok, true);
    assert.strictEqual(declined.declined, true);
    const { rows } = await db.query("SELECT status, error_message FROM department_messages WHERE message_id = $1", [sent.requestId]);
    assert.strictEqual(rows[0].status, "declined");
    assert.match(rows[0].error_message, /No competitors/);
  } finally {
    await deleteUser(userId);
  }
}));

test("request: validation walls — unknown topic, wrong schema, denylist, demo brand, self-message", withFlag("COLLAB_BUS", "true", async () => {
  const real = await createBrand();
  const demo = await createBrand({ isDemo: true });
  try {
    const unknown = await bus.sendRequest({ brandId: real.brandId, fromDept: "forge", topic: "nope.topic", payload: {} });
    assert.match(unknown.error, /Knowledge Registry/);

    const badSchema = await bus.sendRequest({ brandId: real.brandId, fromDept: "forge", topic: "strategy.current", payload: { hax: true } });
    assert.match(badSchema.error, /not allowed/);

    const denylist = await bus.sendRequest({ brandId: real.brandId, fromDept: "sage", topic: "creative.request", payload: { brief: "x", formats: [{ api_key: "sk" }] } });
    assert.match(denylist.error, /denylisted/);

    const demoRejected = await bus.sendRequest({ brandId: demo.brandId, fromDept: "forge", topic: "strategy.current", payload: {} });
    assert.match(demoRejected.error, /demo/);

    const self = await bus.sendRequest({ brandId: real.brandId, fromDept: "sage", topic: "strategy.current", payload: {} });
    assert.match(self.error, /itself/);

    const badDept = await bus.sendRequest({ brandId: real.brandId, fromDept: "hermes", topic: "strategy.current", payload: {} });
    assert.match(badDept.error, /Unknown department/);
  } finally {
    await deleteUser(real.userId);
    await deleteUser(demo.userId);
  }
}));

test("request: response payload is schema-validated and denylist-checked too", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const sent = await bus.sendRequest({ brandId, fromDept: "nova", topic: "customer.language", payload: {} });
    const badResp = await bus.respondToRequest({ requestId: sent.requestId, dept: "voice", payload: { available: true, themes: [], surprise: 1 } });
    assert.match(badResp.error, /not allowed/);
    const secretResp = await bus.respondToRequest({ requestId: sent.requestId, dept: "voice", payload: { available: true, themes: [{ password: "x" }] } });
    assert.match(secretResp.error, /denylisted/);
    const good = await bus.respondToRequest({ requestId: sent.requestId, dept: "voice", payload: { available: true, themes: ["pricing"], objections: [], sample_count: 4 } });
    assert.strictEqual(good.ok, true);
  } finally {
    await deleteUser(userId);
  }
}));

// ---------- Dedup ----------

test("dedup: identical fresh answered request is served from the log", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const first = await bus.sendRequest({ brandId, fromDept: "forge", topic: "truth.company", payload: { context: "brief" } });
    await bus.respondToRequest({ requestId: first.requestId, dept: "sage", payload: { available: true, truth: { positioning: "x" }, version: 2 } });

    const second = await bus.sendRequest({ brandId, fromDept: "nova", topic: "truth.company", payload: { context: "brief" } });
    assert.strictEqual(second.deduplicated, true);
    assert.strictEqual(second.requestId, first.requestId);
    assert.strictEqual(second.response.truth.positioning, "x");

    // Different payload -> new request, no dedup.
    const third = await bus.sendRequest({ brandId, fromDept: "nova", topic: "truth.company", payload: { context: "other" } });
    assert.strictEqual(third.deduplicated, false);

    // Generation topics never dedup-serve.
    const gen1 = await bus.sendRequest({ brandId, fromDept: "sage", topic: "creative.request", payload: { brief: "same brief" } });
    await bus.respondToRequest({ requestId: gen1.requestId, dept: "forge", payload: { available: true, asset_refs: [] } });
    const gen2 = await bus.sendRequest({ brandId, fromDept: "sage", topic: "creative.request", payload: { brief: "same brief" } });
    assert.strictEqual(gen2.deduplicated, false);
  } finally {
    await deleteUser(userId);
  }
}));

// ---------- Reports & alerts ----------

test("reports/alerts: only the owner publishes reports; alert routes only through Echo", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    // Non-owner cannot publish facts about someone else's topic.
    const imposter = await bus.sendReport({ brandId, fromDept: "nova", toDept: "sage", topic: "leads.outcomes", payload: { available: true, counts: { converted: 2 } } });
    assert.strictEqual(imposter.ok, false);
    assert.match(imposter.error, /Only pulse/);

    const rep = await bus.sendReport({ brandId, fromDept: "pulse", toDept: "sage", topic: "leads.outcomes", payload: { available: true, counts: { converted: 2 } } });
    assert.strictEqual(rep.ok, true);
    const { rows } = await db.query("SELECT to_dept, kind FROM department_messages WHERE message_id = $1", [rep.reportId]);
    assert.strictEqual(rows[0].to_dept, "sage");
    assert.strictEqual(rows[0].kind, "report");

    const alert = await bus.sendAlert({ brandId, fromDept: "sentinel", topic: "system.health", payload: { scope: "connections" }, priority: "elevated" });
    assert.strictEqual(alert.ok, true);
    const a = await db.query("SELECT to_dept, kind, priority FROM department_messages WHERE message_id = $1", [alert.alertId]);
    assert.strictEqual(a.rows[0].to_dept, "echo");
    assert.strictEqual(a.rows[0].priority, "elevated");
  } finally {
    await deleteUser(userId);
  }
}));

// ---------- Anti-loop (DB-level) ----------

test("anti-loop: requests can never carry a correlation_id (DB CHECK)", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const sent = await bus.sendRequest({ brandId, fromDept: "forge", topic: "strategy.current", payload: {} });
    await assert.rejects(
      db.query(
        `INSERT INTO department_messages (brand_id, from_dept, to_dept, kind, topic, payload, correlation_id)
         VALUES ($1, 'nova', 'sage', 'request', 'strategy.current', '{}'::jsonb, $2)`,
        [brandId, sent.requestId],
      ),
      /dept_msg_correlation_chk/,
    );
    // plan_id reserved for Echo requests only.
    await assert.rejects(
      db.query(
        `INSERT INTO department_messages (brand_id, from_dept, to_dept, kind, topic, payload, plan_id)
         VALUES ($1, 'nova', 'sage', 'request', 'strategy.current', '{}'::jsonb, gen_random_uuid())`,
        [brandId],
      ),
      /dept_msg_plan_chk/,
    );
  } finally {
    await deleteUser(userId);
  }
}));

// ---------- Daily cap ----------

test("cap: per-brand daily message cap rejects further sends", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    // Seed cap-1 rows cheaply, then one real send hits the cap boundary.
    await db.query(
      `INSERT INTO department_messages (brand_id, from_dept, to_dept, kind, topic, payload)
       SELECT $1, 'pulse', 'sage', 'report', 'leads.outcomes', '{}'::jsonb
         FROM generate_series(1, $2)`,
      [brandId, bus.DAILY_BRAND_MESSAGE_CAP],
    );
    const over = await bus.sendRequest({ brandId, fromDept: "forge", topic: "strategy.current", payload: {} });
    assert.strictEqual(over.ok, false);
    assert.match(over.error, /cap/);
  } finally {
    await deleteUser(userId);
  }
}));

// ---------- Maintenance sweep ----------

test("maintenance: expires overdue, rescues stale claims, purges past retention", withFlag("COLLAB_BUS", "true", async () => {
  const { userId, brandId } = await createBrand();
  try {
    // Overdue sent request.
    const { rows: [overdue] } = await db.query(
      `INSERT INTO department_messages (brand_id, from_dept, to_dept, kind, topic, payload, answer_by)
       VALUES ($1, 'forge', 'sage', 'request', 'strategy.current', '{}'::jsonb, NOW() - interval '1 hour')
       RETURNING message_id`,
      [brandId],
    );
    // Stale claimed request (claimed 3h ago, deadline still ahead).
    const { rows: [stale] } = await db.query(
      `INSERT INTO department_messages (brand_id, from_dept, to_dept, kind, topic, payload, status, claimed_at, answer_by)
       VALUES ($1, 'nova', 'scout', 'request', 'intel.competitor', '{}'::jsonb, 'claimed', NOW() - interval '3 hours', NOW() + interval '12 hours')
       RETURNING message_id`,
      [brandId],
    );
    // Ancient row past retention.
    const { rows: [ancient] } = await db.query(
      `INSERT INTO department_messages (brand_id, from_dept, to_dept, kind, topic, payload, created_at, status)
       VALUES ($1, 'pulse', 'sage', 'report', 'leads.outcomes', '{}'::jsonb, NOW() - interval '200 days', 'sent')
       RETURNING message_id`,
      [brandId],
    );
    const result = await bus.runBusMaintenance();
    assert.strictEqual(result.enabled, true);
    assert.ok(result.expired >= 1);
    assert.ok(result.failed >= 1);
    assert.ok(result.purged >= 1);

    const check = await db.query(
      "SELECT message_id, status, error_message FROM department_messages WHERE message_id = ANY(ARRAY[$1, $2]::uuid[])",
      [overdue.message_id, stale.message_id],
    );
    const byId = Object.fromEntries(check.rows.map((r) => [r.message_id, r]));
    assert.strictEqual(byId[overdue.message_id].status, "expired");
    assert.strictEqual(byId[stale.message_id].status, "failed");
    assert.match(byId[stale.message_id].error_message, /stale claim/);
    const gone = await db.query("SELECT 1 FROM department_messages WHERE message_id = $1", [ancient.message_id]);
    assert.strictEqual(gone.rowCount, 0);

    // Terminal rows are immutable: respond after expiry is rejected.
    const late = await bus.respondToRequest({ requestId: overdue.message_id, dept: "sage", payload: { available: false, reason: "late" } });
    assert.strictEqual(late.ok, false);
  } finally {
    await deleteUser(userId);
  }
}));

// ---------- Activity view ----------

test("activity: brand-scoped recent messages, capped limit", withFlag("COLLAB_BUS", "true", async () => {
  const a = await createBrand();
  const b = await createBrand();
  try {
    await bus.sendRequest({ brandId: a.brandId, fromDept: "forge", topic: "strategy.current", payload: {} });
    await bus.sendRequest({ brandId: b.brandId, fromDept: "nova", topic: "social.calendar", payload: {} });
    const act = await bus.getRecentActivity({ brandId: a.brandId });
    assert.strictEqual(act.enabled, true);
    assert.ok(act.messages.length >= 1);
    assert.ok(act.messages.every((m) => m.topic !== "social.calendar"));
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
  }
}));

// ---------- Flags registered ----------

test("flags: all collaboration flags registered and default OFF", async () => {
  const { getSwitch } = require("../config/aiControls");
  const flags = [
    "COLLAB_BUS", "COLLAB_ACTIVITY_VIEW", "COLLAB_FORGE_SAGE", "COLLAB_ATLAS_INTEL",
    "COLLAB_NOVA_STRATEGY", "COLLAB_PULSE_REPORTS", "COLLAB_VOICE_INSIGHTS",
    "COLLAB_SCOUT_ENRICH", "COLLAB_DEPT_SCORECARDS", "COLLAB_ROUNDTABLE",
  ];
  for (const f of flags) {
    assert.strictEqual(await getSwitch(f), false, `${f} defaults OFF`);
  }
});
