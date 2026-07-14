// Echo companion inbox awareness + auto-drafted email replies.
//
// Covers:
// - buildInboxContext: only fires for email-related questions; returns real
//   inbox data; honest "no account" and "check failed" fallbacks (never guesses).
// - echoEmailController.draft: instruction now optional for a REPLY (Echo
//   drafts from the original email), still required for a brand-new email.
const test = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const companion = require("../controllers/echoCompanionController");
const buildInboxContext = companion._buildInboxContextForTests;

function stubQuery(fn) {
  const original = db.query;
  db.query = fn;
  return () => {
    db.query = original;
  };
}

test("buildInboxContext ignores non-email questions (no DB hit)", async () => {
  let called = 0;
  const restore = stubQuery(async () => {
    called += 1;
    return { rows: [] };
  });
  try {
    assert.strictEqual(await buildInboxContext("u1", "how are my leads doing?"), null);
    assert.strictEqual(await buildInboxContext("u1", ""), null);
    assert.strictEqual(called, 0);
  } finally {
    restore();
  }
});

test("buildInboxContext returns real inbox data for email questions", async () => {
  const restore = stubQuery(async (sql) => {
    if (/FROM email_accounts/.test(sql)) return { rows: [{ n: 1 }] };
    if (/FROM email_messages/.test(sql) && /COUNT/.test(sql)) return { rows: [{ last24: 2 }] };
    return {
      rows: [
        {
          from_name: "Blacor Homes",
          from_address: "james@blacorhomes.com",
          subject: "New Quote Request",
          category: "leads",
          snippet: "Interested in something around 600 s.f.",
          ai_summary: null,
          received_at: new Date("2026-07-10T15:32:00Z"),
        },
      ],
    };
  });
  try {
    const ctx = await buildInboxContext("u1", "do I have any emails in my inbox?");
    assert.ok(ctx.includes("REAL DATA"));
    assert.ok(ctx.includes("2 email(s) arrived in the last 24 hours"));
    assert.ok(ctx.includes("Blacor Homes"));
    assert.ok(ctx.includes("New Quote Request"));
    assert.ok(/NEVER invent emails/i.test(ctx));
  } finally {
    restore();
  }
});

test("buildInboxContext is honest when no email account is connected", async () => {
  const restore = stubQuery(async () => ({ rows: [{ n: 0 }] }));
  try {
    const ctx = await buildInboxContext("u1", "read my emails");
    assert.ok(/NO email account connected/i.test(ctx));
    assert.ok(/never guess/i.test(ctx));
  } finally {
    restore();
  }
});

test("buildInboxContext degrades honestly when the DB check fails", async () => {
  const restore = stubQuery(async () => {
    throw new Error("boom");
  });
  try {
    const ctx = await buildInboxContext("u1", "any new mail?");
    assert.ok(/couldn't check/i.test(ctx));
    assert.ok(/do not guess/i.test(ctx));
  } finally {
    restore();
  }
});

test("email question regex matches the phrasings James used", () => {
  const re = companion._emailQuestionReForTests;
  for (const phrase of [
    "do I have any emails in my inbox",
    "can you read them to me",
    "any new mail today",
    "check my inbox",
    "did I get an email from Blacor",
  ]) {
    assert.ok(re.test(phrase), `matches: ${phrase}`);
  }
  for (const phrase of ["how are my leads", "post to facebook", "what's on my calendar"]) {
    assert.ok(!re.test(phrase), `does not match: ${phrase}`);
  }
});

// --- draft(): instruction optional for replies ------------------------------

const echoEmail = require("../controllers/echoEmailController");

function mockRes() {
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

test("draft still requires an instruction for a brand-new email", async () => {
  const res = mockRes();
  await echoEmail.draft(
    { user: { userId: "u1" }, body: { toAddress: "someone@example.com" } },
    res,
    (err) => {
      throw err;
    },
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /what the email should say/i);
});

test("draft accepts a reply with no instruction (Echo drafts it himself)", async () => {
  // No instruction + replyToMessageId passes validation and proceeds to the
  // message lookup — stub the DB to return no such message so it stops at 404
  // (proving the 400 instruction gate no longer fires for replies).
  const restore = stubQuery(async (sql) => {
    if (/FROM email_messages/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const res = mockRes();
  try {
    await echoEmail.draft(
      { user: { userId: "u1" }, body: { replyToMessageId: "11111111-1111-1111-1111-111111111111" } },
      res,
      (err) => {
        throw err;
      },
    );
    assert.strictEqual(res.statusCode, 404);
  } finally {
    restore();
  }
});
