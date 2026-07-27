const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const {
  clampBudget,
  checkCapacity,
  isBlackedOut,
  toDayString,
} = require("../utils/constraintClamp");
const { normalizeSocialUrl } = require("../utils/onlinePresence");
const objectionsMining = require("../utils/objectionsMining");
const sagePhase4Context = require("../utils/sagePhase4Context");

// ---------------------------------------------------------------------------
// constraintClamp — pure, inert-by-directive helper. Honesty invariants:
// unknown constraint ≠ zero (no clamp), invalid inputs never clamp silently,
// remaining budget floors at 0.
// ---------------------------------------------------------------------------

test("clampBudget: no budget constraint (null) means NO clamp — unknown is not zero", () => {
  assert.deepStrictEqual(clampBudget(50_00, null), {
    allowedCents: 50_00,
    clamped: false,
    reason: null,
  });
  assert.deepStrictEqual(clampBudget(50_00, undefined, 10_00), {
    allowedCents: 50_00,
    clamped: false,
    reason: null,
  });
});

test("clampBudget: within remaining budget passes untouched", () => {
  assert.deepStrictEqual(clampBudget(30_00, 100_00, 60_00), {
    allowedCents: 30_00,
    clamped: false,
    reason: null,
  });
});

test("clampBudget: over remaining budget clamps to remaining, floored at 0", () => {
  assert.deepStrictEqual(clampBudget(50_00, 100_00, 60_00), {
    allowedCents: 40_00,
    clamped: true,
    reason: "monthly_budget_exceeded",
  });
  // Spent already exceeds budget → remaining floors at 0, never negative.
  assert.deepStrictEqual(clampBudget(50_00, 100_00, 150_00), {
    allowedCents: 0,
    clamped: true,
    reason: "monthly_budget_exceeded",
  });
});

test("clampBudget: invalid proposed amount clamps to 0 with an explicit reason", () => {
  assert.deepStrictEqual(clampBudget(NaN, 100_00), {
    allowedCents: 0,
    clamped: true,
    reason: "invalid_proposed_amount",
  });
  assert.strictEqual(clampBudget(-5, 100_00).reason, "invalid_proposed_amount");
});

test("clampBudget: invalid constraint inputs never clamp (flagged, not silent)", () => {
  const r = clampBudget(50_00, NaN, 0);
  assert.deepStrictEqual(r, {
    allowedCents: 50_00,
    clamped: false,
    reason: "invalid_constraint_input",
  });
  assert.strictEqual(clampBudget(50_00, 100_00, -1).clamped, false);
});

test("checkCapacity: unknown capacity fits; over-capacity reports overBy", () => {
  assert.deepStrictEqual(checkCapacity(20, null), { fits: true, overBy: 0, reason: null });
  assert.deepStrictEqual(checkCapacity(8, 10), { fits: true, overBy: 0, reason: null });
  assert.deepStrictEqual(checkCapacity(15, 10), {
    fits: false,
    overBy: 5,
    reason: "weekly_capacity_exceeded",
  });
  assert.strictEqual(checkCapacity(NaN, 10).fits, true);
});

test("isBlackedOut: window membership, open-ended windows, malformed entries skipped", () => {
  const windows = [
    { from: "2026-07-01", to: "2026-07-10", label: "vacation" },
    { from: "2026-12-20" }, // open-ended forward
    null,
    { label: "no dates at all" },
    { from: "garbage" },
  ];
  assert.strictEqual(isBlackedOut("2026-07-05", windows), true);
  assert.strictEqual(isBlackedOut("2026-07-11", windows), false);
  assert.strictEqual(isBlackedOut("2026-12-25", windows), true);
  assert.strictEqual(isBlackedOut("2027-03-01", windows), true); // still open-ended
  assert.strictEqual(isBlackedOut("2026-07-05", []), false);
  assert.strictEqual(isBlackedOut("not-a-date", windows), false);
  assert.strictEqual(isBlackedOut(new Date("2026-07-03T12:00:00Z"), windows), true);
});

test("toDayString: Date and YYYY-MM-DD accepted, garbage is null", () => {
  assert.strictEqual(toDayString("2026-07-18"), "2026-07-18");
  assert.strictEqual(toDayString(new Date("2026-07-18T05:00:00Z")), "2026-07-18");
  assert.strictEqual(toDayString("07/18/2026"), null);
  assert.strictEqual(toDayString(null), null);
});

// ---------------------------------------------------------------------------
// normalizeSocialUrl — Phase 4 URL fields. Same normalize-or-400 contract as
// the website/facebook normalizers; wrong-host inputs must be rejected, never
// silently coerced onto another platform.
// ---------------------------------------------------------------------------

test("normalizeSocialUrl: handles, full URLs, host allowlist, clears", () => {
  assert.deepStrictEqual(normalizeSocialUrl("instagram", "@myshop"), {
    ok: true,
    value: "https://www.instagram.com/myshop",
  });
  assert.deepStrictEqual(normalizeSocialUrl("tiktok", "myshop"), {
    ok: true,
    value: "https://www.tiktok.com/@myshop",
  });
  assert.deepStrictEqual(normalizeSocialUrl("youtube", "youtube.com/@myshop/"), {
    ok: true,
    value: "https://youtube.com/@myshop",
  });
  assert.deepStrictEqual(normalizeSocialUrl("linkedin", "linkedin.com/company/acme"), {
    ok: true,
    value: "https://linkedin.com/company/acme",
  });
  // LinkedIn has no unambiguous handle form → bare handle rejected.
  assert.deepStrictEqual(normalizeSocialUrl("linkedin", "acme"), { ok: false });
  // Wrong host is a rejection, never a coercion.
  assert.deepStrictEqual(normalizeSocialUrl("instagram", "https://facebook.com/myshop"), {
    ok: false,
  });
  assert.strictEqual(normalizeSocialUrl("google_business", "g.page/myshop").ok, true);
  assert.deepStrictEqual(normalizeSocialUrl("google_business", "example.com/biz"), { ok: false });
  // Blank / null clears.
  assert.deepStrictEqual(normalizeSocialUrl("instagram", "  "), { ok: true, value: null });
  assert.deepStrictEqual(normalizeSocialUrl("instagram", null), { ok: true, value: null });
  // Unknown platform key is a programmer error → rejected.
  assert.deepStrictEqual(normalizeSocialUrl("myspace", "x"), { ok: false });
});

// ---------------------------------------------------------------------------
// objectionsMining.parseThemes — strict aggregate-only parsing: singleton
// themes dropped (frequency < 2), malformed entries dropped, JSON extracted
// from surrounding prose, invalid payload → null (aiInvalid upstream).
// ---------------------------------------------------------------------------

test("parseThemes: valid themes kept, singletons and malformed entries dropped", () => {
  const text =
    'Here is my analysis:\n{"themes":[' +
    '{"theme":"Price concerns","frequency":4,"summary":"Leads worry the service costs too much."},' +
    '{"theme":"One-off","frequency":1,"summary":"Appeared once — must be dropped."},' +
    '{"theme":"","frequency":3,"summary":"Empty theme name — dropped."},' +
    '{"theme":"Timing","frequency":"2","summary":"Want service sooner than the schedule allows."}' +
    "]}\nHope that helps!";
  const themes = objectionsMining.parseThemes(text);
  assert.strictEqual(themes.length, 2);
  assert.deepStrictEqual(
    themes.map((t) => t.theme),
    ["Price concerns", "Timing"],
  );
  assert.strictEqual(themes[1].frequency, 2);
});

test("parseThemes: empty themes array is valid (nothing recurs → no fabrication)", () => {
  assert.deepStrictEqual(objectionsMining.parseThemes('{"themes":[]}'), []);
});

test("parseThemes: non-JSON / wrong shape returns null (caller throws aiInvalid)", () => {
  assert.strictEqual(objectionsMining.parseThemes("I could not find objections."), null);
  assert.strictEqual(objectionsMining.parseThemes('{"notThemes":true}'), null);
  assert.strictEqual(objectionsMining.parseThemes('{"themes":"oops"}'), null);
});

test("mineBrandObjections: below MIN_CONVERSATIONS is a no-op skip (nothing fabricated)", async () => {
  const origQuery = db.query;
  db.query = async (sql) => {
    if (/FROM autonomous_conversations/i.test(sql)) return { rows: [] };
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  try {
    const out = await objectionsMining.mineBrandObjections({
      brand_id: "b1",
      brand_name: "Test Co",
    });
    assert.deepStrictEqual(out, { skipped: true, reason: "not_enough_conversations" });
  } finally {
    db.query = origQuery;
  }
});

// ---------------------------------------------------------------------------
// sagePhase4Context — the CEO allowlist rule. Flags forced ON via env (DB
// overrides stubbed empty); db.query scripted. The customer audience must see
// ONLY allowlisted offer fields — never margin_note, constraints, or memory.
// ---------------------------------------------------------------------------

function stubPhase4Db() {
  return async (sql) => {
    if (/FROM ai_settings/i.test(sql)) return { rows: [] }; // no DB overrides → env wins
    if (/FROM sage_offers/i.test(sql)) {
      return {
        rows: [
          {
            name: "Spring Special",
            offer_type: "discount",
            terms: "20% off first service",
            margin_note: "SECRET-MARGIN-NOTE",
            starts_at: "2026-07-01",
            ends_at: null,
          },
        ],
      };
    }
    if (/FROM brand_constraints/i.test(sql)) {
      return {
        rows: [
          {
            monthly_budget_cents: 50000,
            staff_count: 3,
            weekly_capacity: 12,
            blackout_dates: [{ from: "2026-08-01", to: "2026-08-07", label: "vacation" }],
            legal_notes: "SECRET-LEGAL-NOTE",
            cash_flow_note: "SECRET-CASHFLOW-NOTE",
          },
        ],
      };
    }
    if (/FROM sage_memory/i.test(sql)) {
      return { rows: [{ kind: "seasonal_lesson", content: "SECRET-MEMORY-WINTER-SLOW" }] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
}

async function withPhase4Env(fn) {
  const origQuery = db.query;
  const flagKeys = ["SAGE_V2_OFFERS", "SAGE_V2_CONSTRAINTS", "SAGE_V2_EXEC_MEMORY"];
  const origEnv = {};
  for (const k of flagKeys) {
    origEnv[k] = process.env[k];
    process.env[k] = "true";
  }
  db.query = stubPhase4Db();
  sagePhase4Context._resetCacheForTests();
  try {
    await fn();
  } finally {
    db.query = origQuery;
    for (const k of flagKeys) {
      if (origEnv[k] === undefined) delete process.env[k];
      else process.env[k] = origEnv[k];
    }
    sagePhase4Context._resetCacheForTests();
  }
}

test("phase4Context: customer audience gets ONLY allowlisted offer fields — no secrets", async () => {
  await withPhase4Env(async () => {
    const ctx = await sagePhase4Context.phase4ContextForBrand("brand-1", "customer");
    assert.ok(ctx.includes("Spring Special"), "public offer name must appear");
    assert.ok(ctx.includes("20% off first service"), "public terms must appear");
    // The allowlist rule: none of the owner-private fields may ever leak.
    for (const secret of [
      "SECRET-MARGIN-NOTE",
      "SECRET-LEGAL-NOTE",
      "SECRET-CASHFLOW-NOTE",
      "SECRET-MEMORY-WINTER-SLOW",
    ]) {
      assert.ok(!ctx.includes(secret), `customer context leaked ${secret}`);
    }
    assert.ok(!/BUSINESS CONSTRAINTS/.test(ctx), "constraints section is internal-only");
    assert.ok(!/EXECUTIVE MEMORY/.test(ctx), "memory section is internal-only");
  });
});

test("phase4Context: internal audience opts into constraints, memory, and margin notes", async () => {
  await withPhase4Env(async () => {
    const ctx = await sagePhase4Context.phase4ContextForBrand("brand-1", "internal");
    assert.ok(ctx.includes("SECRET-MARGIN-NOTE"), "internal audience sees margin note");
    assert.ok(/BUSINESS CONSTRAINTS/.test(ctx));
    assert.ok(ctx.includes("$500.00"), "budget cents rendered as dollars");
    assert.ok(ctx.includes("SECRET-LEGAL-NOTE"));
    assert.ok(/EXECUTIVE MEMORY/.test(ctx));
    assert.ok(ctx.includes("SECRET-MEMORY-WINTER-SLOW"));
  });
});

test("phase4Context: unknown audience value is treated as customer (fail-closed)", async () => {
  await withPhase4Env(async () => {
    const ctx = await sagePhase4Context.phase4ContextForBrand("brand-1", "internalish");
    assert.ok(!ctx.includes("SECRET-MARGIN-NOTE"));
    assert.ok(!/EXECUTIVE MEMORY/.test(ctx));
  });
});

test("phase4Context: flags off (default env) → empty context, zero platform change", async () => {
  const origQuery = db.query;
  db.query = async (sql) => {
    if (/FROM ai_settings/i.test(sql)) return { rows: [] };
    throw new Error("flag-dark context must not query feature tables");
  };
  sagePhase4Context._resetCacheForTests();
  try {
    const ctx = await sagePhase4Context.phase4ContextForBrand("brand-1", "internal");
    assert.strictEqual(ctx, "");
  } finally {
    db.query = origQuery;
    sagePhase4Context._resetCacheForTests();
  }
});

test("phase4Context: DB failure returns empty string, never throws into the caller", async () => {
  const origQuery = db.query;
  const orig = process.env.SAGE_V2_OFFERS;
  process.env.SAGE_V2_OFFERS = "true";
  db.query = async (sql) => {
    if (/FROM ai_settings/i.test(sql)) return { rows: [] };
    throw new Error("db down");
  };
  sagePhase4Context._resetCacheForTests();
  try {
    const ctx = await sagePhase4Context.phase4ContextForBrand("brand-1", "customer");
    assert.strictEqual(ctx, "");
  } finally {
    db.query = origQuery;
    if (orig === undefined) delete process.env.SAGE_V2_OFFERS;
    else process.env.SAGE_V2_OFFERS = orig;
    sagePhase4Context._resetCacheForTests();
  }
});

// ---------------------------------------------------------------------------
// captureMemoryFromEcho — Echo's [[REMEMBER]] write path: flag-gated,
// ownership-checked, kind-validated, throws on failure (caller only appends
// the spoken "saved" confirmation on real success).
// ---------------------------------------------------------------------------

const sagePhase4Controller = require("../controllers/sagePhase4Controller");

test("captureMemoryFromEcho: flag off → throws (Echo never claims a save)", async () => {
  const origQuery = db.query;
  db.query = async (sql) => {
    if (/FROM ai_settings/i.test(sql)) return { rows: [] };
    throw new Error("must not write while flag-dark");
  };
  try {
    await assert.rejects(
      sagePhase4Controller.captureMemoryFromEcho("u1", "b1", "vendor", "text", "owner_chat"),
      /not enabled/i,
    );
  } finally {
    db.query = origQuery;
  }
});

test("captureMemoryFromEcho: unknown kind coerces to owner_context; empty content throws", async () => {
  const origQuery = db.query;
  const orig = process.env.SAGE_V2_EXEC_MEMORY;
  process.env.SAGE_V2_EXEC_MEMORY = "true";
  const inserts = [];
  db.query = async (sql, params = []) => {
    if (/FROM ai_settings/i.test(sql)) return { rows: [] };
    if (/FROM brands/i.test(sql)) return { rows: [{ brand_id: params[1] ?? "b1" }] };
    if (/INSERT INTO sage_memory/i.test(sql)) {
      inserts.push(params);
      return { rows: [{ memory_id: "m1", kind: params[1], content: params[2] }] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  try {
    const row = await sagePhase4Controller.captureMemoryFromEcho(
      "u1",
      "b1",
      "not_a_kind",
      "Winter is our slow season",
      "owner_voice",
    );
    assert.strictEqual(row.kind, "owner_context");
    assert.strictEqual(inserts[0][3], "owner_voice");
    await assert.rejects(
      sagePhase4Controller.captureMemoryFromEcho("u1", "b1", "vendor", "   ", "owner_chat"),
      /empty memory/i,
    );
  } finally {
    db.query = origQuery;
    if (orig === undefined) delete process.env.SAGE_V2_EXEC_MEMORY;
    else process.env.SAGE_V2_EXEC_MEMORY = orig;
  }
});
