// 026-C3-PM3 (PM3-R1 / PM3-R12) — REAL contract binding for the accounts
// endpoint that feeds the AdsDestinationCapture Page picker.
//
// The PM2 live re-proof exposed a shipped defect: the capture read a phantom
// `pages` field from /api/facebook/verify (which returns only { ok, checks }),
// and the client test mocked that impossible shape, concealing it. Standing
// mock-fidelity rule (026-C3-PM3 §G): every cross-boundary read must have at
// least one test asserting the ACTUAL server response shape; client mocks
// derive from it.
//
// These tests exercise the REAL facebookOAuthController.getConnectedAccounts
// (the handler mounted at GET /api/facebook/accounts by facebookOAuthRoutes),
// with only db.query swapped for a row fake (established harness pattern —
// same as facebookUnified.test.js). The response assertions are therefore the
// controller's genuine serialized contract, not a mocked one.
//
// The stored-snapshot authority path is bound deterministically by staging a
// row WITHOUT an api_token_encrypted value, which the controller's own guard
// uses to skip its best-effort live Graph refresh (that refresh falls back to
// the stored snapshot on any failure and "must never break the picker" — its
// network behavior is deliberately not exercised in tests).

const { test } = require("node:test");
const assert = require("node:assert");

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const fbOAuth = require("../controllers/facebookOAuthController");

const STORED_PAGES = [
  { id: "140006069194366", name: "South Dixie Storage", category: "Portable Building Service" },
];
const AD_ACCOUNTS = [{ id: "act_185098744942162", name: "SDS Ads" }];

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("PM3-R1: GET /api/facebook/accounts (real controller) returns pages[] in the exact shape the capture consumes", async () => {
  const orig = db.query;
  db.query = async (sql) => {
    if (sql.includes("FROM api_integrations")) {
      return {
        rows: [
          {
            account_ref: "act_185098744942162",
            facebook_ad_accounts: AD_ACCOUNTS,
            page_ref: "140006069194366",
            facebook_pages: STORED_PAGES,
            facebook_page_tokens: null,
            // No token → the controller's live-refresh guard is not entered;
            // the response is the Store-1 stored granted-page snapshot.
            api_token_encrypted: null,
            connection_status: "connected",
          },
        ],
      };
    }
    throw new Error("unexpected query: " + sql);
  };
  try {
    const res = makeRes();
    await fbOAuth.getConnectedAccounts({ user: { userId: "u-1" } }, res);
    assert.strictEqual(res.statusCode, 200);
    const body = res.body;

    // Top-level contract fields (the full serialized shape).
    assert.deepStrictEqual(
      Object.keys(body).sort(),
      [
        "accounts",
        "configured",
        "connected",
        "connectionStatus",
        "pages",
        "selectedAccountId",
        "selectedPageId",
      ],
    );
    assert.strictEqual(body.connected, true);
    assert.strictEqual(body.connectionStatus, "connected");
    assert.strictEqual(body.selectedAccountId, "act_185098744942162");
    assert.strictEqual(body.selectedPageId, "140006069194366");
    assert.deepStrictEqual(body.accounts, AD_ACCOUNTS);

    // PM3-R2 source of truth: the stored granted Page rides pages[] in EXACTLY
    // the fields AdsDestinationCapture consumes (p.id for value/testid,
    // p.name for the label; category tags along from connect time).
    assert.ok(Array.isArray(body.pages));
    assert.strictEqual(body.pages.length, 1);
    assert.deepStrictEqual(body.pages[0], {
      id: "140006069194366",
      name: "South Dixie Storage",
      category: "Portable Building Service",
    });

    // PM3-R13 corollary: this endpoint — not /api/facebook/verify — is the
    // Page-candidate contract. (verifyConnection returns { ok, checks } only;
    // asserted in its own source, bound here by the capture no longer reading
    // pages from verify at all.)
  } finally {
    db.query = orig;
  }
});

test("PM3-R12: a genuinely page-less account returns real pages: [] (never undefined) — the zero-page reconnect UI binds to this shape", async () => {
  const orig = db.query;
  db.query = async () => ({ rows: [] });
  try {
    const res = makeRes();
    await fbOAuth.getConnectedAccounts({ user: { userId: "u-2" } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connected, false);
    // The defect class this corrective kills: verify.pages was UNDEFINED
    // (phantom field). The real accounts contract always materializes pages
    // as an array, so `pages: []` now genuinely means "no granted Pages".
    assert.ok(Array.isArray(res.body.pages));
    assert.strictEqual(res.body.pages.length, 0);
    assert.notStrictEqual(res.body.pages, undefined);
  } finally {
    db.query = orig;
  }
});

test("PM3-R12b: a connected account whose grant holds zero Pages also returns pages: [] through the real controller", async () => {
  const orig = db.query;
  db.query = async (sql) => {
    if (sql.includes("FROM api_integrations")) {
      return {
        rows: [
          {
            account_ref: null,
            facebook_ad_accounts: [],
            page_ref: null,
            facebook_pages: [],
            facebook_page_tokens: null,
            api_token_encrypted: null,
            connection_status: "connected",
          },
        ],
      };
    }
    throw new Error("unexpected query: " + sql);
  };
  try {
    const res = makeRes();
    await fbOAuth.getConnectedAccounts({ user: { userId: "u-3" } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connected, true);
    assert.deepStrictEqual(res.body.pages, []);
  } finally {
    db.query = orig;
  }
});
