// providerVerification contract: fails CLOSED (false) on any query error,
// so the UI never claims a provider verified when the platform can't prove it.
const test = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const { providerVerification } = require("../controllers/guidedSetupController");

test("providerVerification fails closed (false) when every query errors", async () => {
  const original = db.query;
  db.query = async () => {
    throw new Error("db down");
  };
  try {
    const v = await providerVerification();
    assert.deepStrictEqual(v, {
      google: false,
      facebook: false,
      instagram: false,
      jobber: false,
      email: true, // user-supplied credentials verify themselves at connect time
    });
  } finally {
    db.query = original;
  }
});

test("providerVerification reports verified only from real connected rows", async () => {
  const original = db.query;
  db.query = async (sql) => {
    if (sql.includes("google_integrations")) return { rows: [{ 1: 1 }] };
    return { rows: [] };
  };
  try {
    const v = await providerVerification();
    assert.strictEqual(v.google, true);
    assert.strictEqual(v.facebook, false);
    assert.strictEqual(v.instagram, false); // rides on Facebook
    assert.strictEqual(v.jobber, false);
  } finally {
    db.query = original;
  }
});
