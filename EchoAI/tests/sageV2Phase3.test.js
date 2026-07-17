// Sage V2 Phase 3 — outcome capture, attribution stamps, coverage math,
// briefing outcome asks. Both flags default OFF; tests flip them via
// process.env (aiControls checks env after DB overrides) and restore after.
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const db = require("../config/db");

const leadOutcome = require("../utils/leadOutcome");

const FLAG = "SAGE_V2_OUTCOME_CAPTURE";

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

async function createBrand() {
  const email = `sagep3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id",
    [email],
  );
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'SageP3 Test Brand') RETURNING brand_id",
    [u.rows[0].user_id],
  );
  return { userId: u.rows[0].user_id, brandId: b.rows[0].brand_id };
}

async function createLead(brandId, fields = {}) {
  const r = await db.query(
    `INSERT INTO leads (brand_id, lead_name, temperature, conversion_status)
     VALUES ($1, $2, $3, $4) RETURNING lead_id`,
    [brandId, fields.lead_name || "P3 Lead", fields.temperature || "hot", fields.conversion_status || "new"],
  );
  return r.rows[0].lead_id;
}

async function getLead(leadId) {
  const r = await db.query("SELECT * FROM leads WHERE lead_id = $1", [leadId]);
  return r.rows[0];
}

async function deleteUser(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// ---------------------------------------------------------------------------
// Flag off — every write path is a no-op
// ---------------------------------------------------------------------------
test("flag off: markWonFromConvert, setFirstTouch, setCampaign, queueOutcomeQuestions all no-op", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const leadId = await createLead(brandId);
    assert.strictEqual(await leadOutcome.captureEnabled(), false);
    assert.strictEqual(await leadOutcome.markWonFromConvert(leadId, "crm", "manual"), false);
    assert.strictEqual(await leadOutcome.setFirstTouch(leadId, "chatbot"), false);
    assert.strictEqual(await leadOutcome.setCampaign(leadId, "00000000-0000-0000-0000-000000000000"), false);
    assert.strictEqual(await leadOutcome.queueOutcomeQuestions([brandId]), 0);
    const lead = await getLead(leadId);
    assert.strictEqual(lead.outcome, null);
    assert.strictEqual(lead.first_touch, null);
    assert.strictEqual(lead.campaign_id, null);
  } finally {
    await deleteUser(userId);
  }
});

test("flag off: applyOutcomeAnswer records nothing", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const leadId = await createLead(brandId);
    const ok = await leadOutcome.applyOutcomeAnswer(`sage_outcome_ask:${leadId}`, "yes we won it for $5000");
    assert.strictEqual(ok, false);
    assert.strictEqual((await getLead(leadId)).outcome, null);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// recordOutcome — validation and writes
// ---------------------------------------------------------------------------
test(
  "recordOutcome writes outcome, reason, value; rejects bad inputs; never defaults value",
  withFlag(FLAG, "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const leadId = await createLead(brandId);

      await assert.rejects(() => leadOutcome.recordOutcome(leadId, { outcome: "maybe", source: "owner" }));
      await assert.rejects(() => leadOutcome.recordOutcome(leadId, { outcome: "won", source: "robot" }));
      await assert.rejects(() =>
        leadOutcome.recordOutcome(leadId, { outcome: "won", source: "owner", dealValueCents: -5 }),
      );
      await assert.rejects(() =>
        leadOutcome.recordOutcome(leadId, { outcome: "won", source: "owner", dealValueCents: 10.5 }),
      );

      // Won without a value → NULL value ("won, value pending"), never 0.
      const row = await leadOutcome.recordOutcome(leadId, { outcome: "won", source: "owner" });
      assert.strictEqual(row.outcome, "won");
      assert.strictEqual(row.deal_value_cents, null);
      assert.strictEqual(row.outcome_source, "owner");
      assert.ok(row.outcome_at);

      // Owner overwrite is allowed (owner is the authority).
      const row2 = await leadOutcome.recordOutcome(leadId, {
        outcome: "lost",
        reason: "went with a competitor",
        source: "owner",
      });
      assert.strictEqual(row2.outcome, "lost");
      assert.strictEqual(row2.outcome_reason, "went with a competitor");

      // Unknown lead → null, no throw.
      const none = await leadOutcome.recordOutcome("00000000-0000-0000-0000-000000000000", {
        outcome: "won",
        source: "owner",
      });
      assert.strictEqual(none, null);
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// markWonFromConvert — one-way sync, never clobbers
// ---------------------------------------------------------------------------
test(
  "markWonFromConvert sets won only when outcome is NULL and stamps converting_touch once",
  withFlag(FLAG, "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const leadId = await createLead(brandId);
      assert.strictEqual(await leadOutcome.markWonFromConvert(leadId, "autonomous", "sms"), true);
      let lead = await getLead(leadId);
      assert.strictEqual(lead.outcome, "won");
      assert.strictEqual(lead.outcome_source, "autonomous");
      assert.strictEqual(lead.converting_touch, "sms");
      assert.strictEqual(lead.deal_value_cents, null); // value pending, never fabricated

      // Second convert never clobbers.
      assert.strictEqual(await leadOutcome.markWonFromConvert(leadId, "crm", "manual"), false);
      lead = await getLead(leadId);
      assert.strictEqual(lead.outcome_source, "autonomous");
      assert.strictEqual(lead.converting_touch, "sms");

      // Owner-entered outcome is never overwritten by a later convert.
      const leadId2 = await createLead(brandId);
      await leadOutcome.recordOutcome(leadId2, { outcome: "lost", source: "owner" });
      assert.strictEqual(await leadOutcome.markWonFromConvert(leadId2, "crm", "manual"), false);
      assert.strictEqual((await getLead(leadId2)).outcome, "lost");

      // Invalid touch is dropped, outcome still recorded.
      const leadId3 = await createLead(brandId);
      assert.strictEqual(await leadOutcome.markWonFromConvert(leadId3, "crm", "carrier-pigeon"), true);
      assert.strictEqual((await getLead(leadId3)).converting_touch, null);
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// setFirstTouch — stamp once
// ---------------------------------------------------------------------------
test(
  "setFirstTouch stamps once and rejects unknown touches",
  withFlag(FLAG, "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const leadId = await createLead(brandId);
      assert.strictEqual(await leadOutcome.setFirstTouch(leadId, "chatbot"), true);
      assert.strictEqual(await leadOutcome.setFirstTouch(leadId, "sms"), false); // already stamped
      assert.strictEqual((await getLead(leadId)).first_touch, "chatbot");
      assert.strictEqual(await leadOutcome.setFirstTouch(leadId, "telepathy"), false);
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Coverage math — deterministic, honest denominators
// ---------------------------------------------------------------------------
test(
  "coverageForBrand counts every lead, flags <30% as insufficient, surfaces value-less wins",
  withFlag(FLAG, "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      // 10 leads: 2 with outcomes (20% → insufficient), one won w/ value, one won without.
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push(await createLead(brandId, { lead_name: `L${i}` }));
      await leadOutcome.recordOutcome(ids[0], { outcome: "won", source: "owner", dealValueCents: 250000 });
      await leadOutcome.recordOutcome(ids[1], { outcome: "won", source: "owner" });

      let c = await leadOutcome.coverageForBrand(brandId);
      assert.strictEqual(c.totalLeads, 10);
      assert.strictEqual(c.withOutcome, 2);
      assert.strictEqual(c.coveragePct, 20);
      assert.strictEqual(c.sufficient, false);
      assert.strictEqual(c.won, 2);
      assert.strictEqual(c.wonValueMissing, 1);
      assert.strictEqual(c.wonValueCents, 250000);

      // One more outcome → 30% → sufficient (boundary inclusive).
      await leadOutcome.recordOutcome(ids[2], { outcome: "lost", source: "owner" });
      c = await leadOutcome.coverageForBrand(brandId);
      assert.strictEqual(c.coveragePct, 30);
      assert.strictEqual(c.sufficient, true);

      // Empty brand → 0% and no division blow-up.
      const other = await createBrand();
      try {
        const empty = await leadOutcome.coverageForBrand(other.brandId);
        assert.strictEqual(empty.totalLeads, 0);
        assert.strictEqual(empty.coveragePct, 0);
        assert.strictEqual(empty.sufficient, false);
      } finally {
        await deleteUser(other.userId);
      }
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Briefing outcome asks
// ---------------------------------------------------------------------------
test(
  "queueOutcomeQuestions queues stale hot leads with past appointments, dedups, skips resolved leads",
  withFlag(FLAG, "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const staleLead = await createLead(brandId, { lead_name: "The Hendersons" });
      const resolvedLead = await createLead(brandId, { lead_name: "Closed Already" });
      await db.query(
        `INSERT INTO appointments (brand_id, lead_id, start_time, end_time, status)
         VALUES ($1, $2, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '1 hour', 'scheduled'),
                ($1, $3, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days' + INTERVAL '1 hour', 'scheduled')`,
        [brandId, staleLead, resolvedLead],
      );
      await leadOutcome.recordOutcome(resolvedLead, { outcome: "won", source: "owner" });
      // trg_leads_updated_at resets updated_at on every UPDATE; disable it
      // while staging stale timestamps (test-only), then re-enable.
      await db.query("ALTER TABLE leads DISABLE TRIGGER trg_leads_updated_at");
      try {
        await db.query("UPDATE leads SET updated_at = NOW() - INTERVAL '3 days' WHERE brand_id = $1", [brandId]);
      } finally {
        await db.query("ALTER TABLE leads ENABLE TRIGGER trg_leads_updated_at");
      }

      const queued = await leadOutcome.queueOutcomeQuestions([brandId]);
      assert.strictEqual(queued, 1);
      const q = await db.query(
        "SELECT question, context FROM echo_open_questions WHERE brand_id = $1",
        [brandId],
      );
      assert.strictEqual(q.rows.length, 1);
      assert.ok(q.rows[0].question.includes("The Hendersons"));
      assert.strictEqual(q.rows[0].context, `sage_outcome_ask:${staleLead}`);
      assert.strictEqual(leadOutcome.outcomeAskLeadId(q.rows[0].context), staleLead);

      // Second run dedups via the unique constraint.
      assert.strictEqual(await leadOutcome.queueOutcomeQuestions([brandId]), 0);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test("outcomeAskLeadId only parses the outcome-ask tag", () => {
  assert.strictEqual(leadOutcome.outcomeAskLeadId("sage_outcome_ask:abc-123"), "abc-123");
  assert.strictEqual(leadOutcome.outcomeAskLeadId("sage_outcome_ask:"), null);
  assert.strictEqual(leadOutcome.outcomeAskLeadId("weekly_report:xyz"), null);
  assert.strictEqual(leadOutcome.outcomeAskLeadId(null), null);
  assert.strictEqual(leadOutcome.outcomeAskLeadId(42), null);
});

test(
  "parseOutcomeAnswer fails closed when Hermes is not configured; applyOutcomeAnswer writes nothing",
  withFlag(FLAG, "true", async () => {
    const prev = process.env.NOUS_PORTAL_API_KEY;
    delete process.env.NOUS_PORTAL_API_KEY;
    try {
      assert.strictEqual(await leadOutcome.parseOutcomeAnswer("we closed it for $9000"), null);
      const { userId, brandId } = await createBrand();
      try {
        const leadId = await createLead(brandId);
        const ok = await leadOutcome.applyOutcomeAnswer(`sage_outcome_ask:${leadId}`, "we closed it");
        assert.strictEqual(ok, false);
        assert.strictEqual((await getLead(leadId)).outcome, null); // fail closed
      } finally {
        await deleteUser(userId);
      }
    } finally {
      if (prev !== undefined) process.env.NOUS_PORTAL_API_KEY = prev;
    }
  }),
);

test(
  "applyOutcomeAnswer records a parsed outcome with source voice, only when outcome is NULL",
  withFlag(FLAG, "true", async () => {
    const { userId, brandId } = await createBrand();
    const hermes = require("../config/hermes");
    const realCreate = hermes.createCompletion;
    const realConfigured = hermes.hermesConfigured;
    hermes.hermesConfigured = () => true;
    hermes.createCompletion = async () =>
      '{"outcome":"won","dealValueDollars":2500,"reason":"signed Tuesday"}';
    try {
      const leadId = await createLead(brandId);
      const ok = await leadOutcome.applyOutcomeAnswer(`sage_outcome_ask:${leadId}`, "yep, $2,500, signed Tuesday");
      assert.strictEqual(ok, true);
      const lead = await getLead(leadId);
      assert.strictEqual(lead.outcome, "won");
      assert.strictEqual(lead.outcome_source, "voice");
      assert.strictEqual(Number(lead.deal_value_cents), 250000);
      assert.strictEqual(lead.outcome_reason, "signed Tuesday");

      // Existing outcome is never clobbered by a voice answer.
      hermes.createCompletion = async () => '{"outcome":"lost","dealValueDollars":null,"reason":null}';
      assert.strictEqual(await leadOutcome.applyOutcomeAnswer(`sage_outcome_ask:${leadId}`, "actually no"), false);
      assert.strictEqual((await getLead(leadId)).outcome, "won");

      // "unclear" fails closed.
      const leadId2 = await createLead(brandId);
      hermes.createCompletion = async () => '{"outcome":"unclear","dealValueDollars":null,"reason":null}';
      assert.strictEqual(await leadOutcome.applyOutcomeAnswer(`sage_outcome_ask:${leadId2}`, "hmm"), false);
      assert.strictEqual((await getLead(leadId2)).outcome, null);
    } finally {
      hermes.createCompletion = realCreate;
      hermes.hermesConfigured = realConfigured;
      await deleteUser(userId);
    }
  }),
);
