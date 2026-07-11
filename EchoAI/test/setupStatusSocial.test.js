const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Guided-setup social probe: the "connect a social account" step must tell the
// truth about WHY it's incomplete. A brand with a social_accounts row in
// 'error' DID connect an account — telling the owner to "connect one" when
// they already did reads as a bug. The step label must say "reconnect" for a
// broken connection and only say "connect" when there is truly no row at all.
// db.query is swapped for a fake (same pattern as socialReverify.test.js).
// ---------------------------------------------------------------------------

const db = require("../config/db");
const { computeSetupStatus } = require("../utils/setupStatus");

function makeDb(socialRows) {
  return async function query(sql) {
    if (/FROM social_accounts/i.test(sql)) {
      return { rows: socialRows };
    }
    if (/FROM brands/i.test(sql)) {
      return {
        rows: [
          {
            brand_name: "Blacor",
            brand_personality: "bold",
            voice_description: "warm",
            target_audience: "homeowners",
          },
        ],
      };
    }
    // Every other probe reports "done" so the social feature is isolated.
    return { rows: [{ ok: 1 }] };
  };
}

function socialFeature(status) {
  return status.features.find((f) => f.key === "social");
}

test("no social_accounts row at all -> step says 'connect'", async (t) => {
  const orig = db.query;
  db.query = makeDb([]);
  t.after(() => {
    db.query = orig;
  });

  const status = await computeSetupStatus("u1", "b1");
  const social = socialFeature(status);
  assert.equal(social.status, "incomplete");
  const step = social.steps[0];
  assert.equal(step.done, false);
  assert.match(step.label, /connect at least one social account/i);
});

test("a row in 'error' -> step says 'reconnect', never 'connect one'", async (t) => {
  const orig = db.query;
  db.query = makeDb([{ connection_status: "error" }]);
  t.after(() => {
    db.query = orig;
  });

  const status = await computeSetupStatus("u1", "b1");
  const social = socialFeature(status);
  assert.equal(social.status, "incomplete");
  const step = social.steps[0];
  assert.equal(step.done, false);
  assert.match(step.label, /reconnect/i);
  assert.doesNotMatch(step.label, /connect at least one/i);
});

test("a row in 'disconnected' -> step also says 'reconnect' (any non-connected row means they DID connect once)", async (t) => {
  const orig = db.query;
  db.query = makeDb([{ connection_status: "disconnected" }]);
  t.after(() => {
    db.query = orig;
  });

  const status = await computeSetupStatus("u1", "b1");
  const social = socialFeature(status);
  assert.equal(social.status, "incomplete");
  const step = social.steps[0];
  assert.equal(step.done, false);
  assert.match(step.label, /reconnect/i);
  assert.doesNotMatch(step.label, /connect at least one/i);
});

test("a 'connected' row marks the connect step done (error rows alongside don't hide it)", async (t) => {
  const orig = db.query;
  db.query = makeDb([
    { connection_status: "error" },
    { connection_status: "connected" },
  ]);
  t.after(() => {
    db.query = orig;
  });

  const status = await computeSetupStatus("u1", "b1");
  const social = socialFeature(status);
  const step = social.steps[0];
  assert.equal(step.done, true);
});
