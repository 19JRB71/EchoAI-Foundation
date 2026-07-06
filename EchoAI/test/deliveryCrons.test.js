const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Per-item guard regressions for the three high-frequency delivery crons:
// publishDuePosts (every minute), executeDueTouchpoints (every 5 minutes) and
// sendDueDripEmails (hourly). Mirrors the fake-db pattern in
// recurringSweeps.test.js: one customer's broken post/touchpoint/email must be
// contained by the per-item guard so every following customer's delivery on
// that tick still goes out. A refactor that lifts work out of the per-item
// try/catch turns into a loud failure here instead of silently stopping
// everyone's scheduled sends.
// ---------------------------------------------------------------------------

// Tests never talk to a real database, SMTP server, or social platform:
// db.query/db.getClient are swapped for the fakes below, nodemailer's
// transport is stubbed before anything can lazily create the real one, and
// socialApi.publishPost is stubbed per test. Unrecognized queries throw so
// nothing can silently reach network.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
// Deterministic tracked-link base URL and no slow send retries/backoff.
process.env.PUBLIC_BASE_URL = "https://example.com";
process.env.EMAIL_MAX_RETRIES = "1";

// Stub the mail transport BEFORE any controller lazily builds the real one.
// utils/email caches the first transporter, so the stub must be in place up
// front; sendMailImpl stays swappable per test.
const nodemailer = require("nodemailer");
let sendMailImpl = async () => {
  throw new Error("deliveryCrons.test: unexpected sendMail call");
};
nodemailer.createTransport = () => ({
  sendMail: (message) => sendMailImpl(message),
});

const db = require("../config/db");
const { encrypt } = require("../utils/encryption");
const socialApi = require("../utils/socialApi");
const { publishDuePosts } = require("../controllers/socialController");
const { executeDueTouchpoints } = require("../controllers/followUpController");
const { sendDueDripEmails } = require("../controllers/emailMarketingController");

// --- Social posts (every minute) ----------------------------------------------

/**
 * In-memory stand-in for db.query covering publishDuePosts. The claim UPDATE
 * returns both due posts; the broken brand's social_accounts read (the first
 * query publishStoredPost makes) throws a hard db failure, which must be
 * contained by the loop's per-post guard. Every unrecognized query throws.
 */
function makeSocialDb(seed) {
  const state = { published: [], failed: [], failedErrors: [], retried: [], rescued: [] };

  async function query(sql, params = []) {
    // 0) The stale-'publishing' rescue sweep that runs before the claim.
    if (
      /UPDATE social_posts/i.test(sql) &&
      /SET status = 'failed'/i.test(sql) &&
      /status = 'publishing' AND updated_at/i.test(sql)
    ) {
      state.rescued.push(...(seed.stalePosts || []).map((p) => p.post_id));
      return { rows: (seed.stalePosts || []).map((p) => ({ ...p })) };
    }

    // 1) The atomic claim (the run's first, unguarded query).
    if (/UPDATE social_posts/i.test(sql) && /SET status = 'publishing'/i.test(sql)) {
      return { rows: seed.posts.map((p) => ({ ...p })) };
    }

    // 2) Connected-account read inside publishStoredPost — throws for the
    // broken brand, escaping straight into the loop's per-post guard.
    if (/FROM social_accounts/i.test(sql)) {
      if ((seed.failAccountForBrands || []).includes(params[0])) {
        throw new Error(`social_accounts unreadable for ${params[0]}`);
      }
      return {
        rows: [
          {
            account_id: "acct-1",
            platform_username: "fineco",
            credentials_encrypted: encrypt(JSON.stringify({ accessToken: "tok" })),
            connection_status: "connected",
          },
        ],
      };
    }

    // 3) Success path — the proof a post fully published.
    if (/UPDATE social_posts/i.test(sql) && /SET status = 'published'/i.test(sql)) {
      state.published.push(params[1]);
      return { rows: [] };
    }

    // 4) Failure path — the per-post guard marking the broken post failed.
    if (/UPDATE social_posts/i.test(sql) && /SET status = 'failed'/i.test(sql)) {
      state.failed.push(params[1]);
      state.failedErrors.push(params[0]);
      return { rows: [] };
    }

    // 5) Transient-retry path — the post is re-queued as 'scheduled' for one
    // automatic retry a few minutes out (guarded on status = 'publishing').
    if (
      /UPDATE social_posts/i.test(sql) &&
      /SET status = 'scheduled'/i.test(sql) &&
      /status = 'publishing'/i.test(sql)
    ) {
      state.retried.push(params[0]);
      return { rows: [] };
    }

    throw new Error(`makeSocialDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("publishDuePosts: post 1's hard failure never stops post 2's publish", async () => {
  const fake = makeSocialDb({
    posts: [
      { post_id: "p1", brand_id: "b1", platform: "facebook", post_content: "broken" },
      { post_id: "p2", brand_id: "b2", platform: "facebook", post_content: "fine" },
    ],
    failAccountForBrands: ["b1"],
  });

  const platformCalls = [];
  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async (platform, credentials, { content }) => {
    platformCalls.push(content);
    return { externalId: "ext-1" };
  };

  try {
    // Must resolve — post 1's throw is contained by the per-post guard.
    const summary = await publishDuePosts();

    // Post 1 blew up before reaching the platform and was marked failed...
    assert.deepStrictEqual(fake.state.failed, ["p1"], "the broken post must be marked failed");
    assert.deepStrictEqual(
      platformCalls,
      ["fine"],
      "only the healthy post may reach the platform API",
    );
    // ...but post 2 still published.
    assert.deepStrictEqual(
      fake.state.published,
      ["p2"],
      "the next post must still publish after post 1 throws",
    );
    assert.deepStrictEqual(summary, { due: 2, published: 1 });
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

test("publishDuePosts: a post stranded in 'publishing' by a crash is marked failed; a fresh in-flight one is left alone", async () => {
  // Two rows sit in 'publishing': p-stale was claimed 30 minutes ago by a
  // tick the server crash killed mid-publish; p-fresh was claimed a minute
  // ago by a concurrent tick that's still working. The rescue sweep must
  // resolve only the stale one — and must mark it failed rather than
  // re-publish it, since the crash may have happened after the platform
  // call already succeeded (double-posting risk).
  const MINUTE = 60 * 1000;
  const now = Date.now();
  const table = [
    { post_id: "p-stale", status: "publishing", updated_at: now - 30 * MINUTE, engagement_metrics: null },
    { post_id: "p-fresh", status: "publishing", updated_at: now - 1 * MINUTE, engagement_metrics: null },
  ];

  const platformCalls = [];
  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  socialApi.publishPost = async (platform, credentials, { content }) => {
    platformCalls.push(content);
    return { externalId: "ext-never" };
  };

  db.query = async (sql, params = []) => {
    // The rescue sweep — emulate its WHERE clause against the in-memory table.
    if (
      /UPDATE social_posts/i.test(sql) &&
      /SET status = 'failed'/i.test(sql) &&
      /status = 'publishing' AND updated_at < NOW\(\) - INTERVAL '10 minutes'/i.test(sql)
    ) {
      const cutoff = Date.now() - 10 * MINUTE;
      const hit = table.filter((r) => r.status === "publishing" && r.updated_at < cutoff);
      for (const r of hit) {
        r.status = "failed";
        r.engagement_metrics = params[0];
      }
      return { rows: hit.map((r) => ({ post_id: r.post_id })) };
    }

    // The regular claim — nothing newly due on this tick.
    if (/UPDATE social_posts/i.test(sql) && /SET status = 'publishing'/i.test(sql)) {
      return { rows: [] };
    }

    throw new Error(`stale-rescue test: unexpected query: ${sql.slice(0, 80)}`);
  };

  try {
    const summary = await publishDuePosts();

    const stale = table.find((r) => r.post_id === "p-stale");
    const fresh = table.find((r) => r.post_id === "p-fresh");

    // The stranded post is resolved: failed with an explanatory error the
    // owner can see, never silently stuck.
    assert.strictEqual(stale.status, "failed", "the stale 'publishing' post must be marked failed");
    assert.match(
      JSON.parse(stale.engagement_metrics).error,
      /interrupted by a server restart/i,
      "the failure must carry a clear explanation for the owner",
    );

    // The fresh in-flight claim from a concurrent tick is untouched.
    assert.strictEqual(fresh.status, "publishing", "a fresh in-flight post must be left alone");
    assert.strictEqual(fresh.engagement_metrics, null);

    // Rescue never re-publishes — double-posting risk.
    assert.deepStrictEqual(platformCalls, [], "the rescue sweep must never call the platform API");
    assert.deepStrictEqual(summary, { due: 0, published: 0 });
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

test("publishDuePosts: a transient platform error re-queues the post for one automatic retry instead of failing it", async () => {
  // Timeouts, 5xx responses, and rate limits are one-off hiccups a retry a few
  // minutes later usually resolves — the owner should never have to reschedule
  // by hand for those.
  const transientErrors = [
    Object.assign(new Error("503 Service Unavailable"), { statusCode: 503 }),
    Object.assign(new Error("429 Too Many Requests"), { statusCode: 429 }),
    Object.assign(new Error("Network error contacting platform: timeout"), {
      transient: true,
    }),
  ];

  for (const boom of transientErrors) {
    const fake = makeSocialDb({
      posts: [
        {
          post_id: "p1",
          brand_id: "b1",
          platform: "facebook",
          post_content: "flaky",
          publish_attempts: 0,
        },
      ],
    });

    const origQuery = db.query;
    const origPublish = socialApi.publishPost;
    db.query = fake.query;
    socialApi.publishPost = async () => {
      throw boom;
    };

    try {
      const summary = await publishDuePosts();

      assert.deepStrictEqual(
        fake.state.retried,
        ["p1"],
        `'${boom.message}' must re-queue the post for a retry`,
      );
      assert.deepStrictEqual(
        fake.state.failed,
        [],
        `'${boom.message}' must not mark the post failed on the first attempt`,
      );
      assert.deepStrictEqual(summary, { due: 1, published: 0 });
    } finally {
      db.query = origQuery;
      socialApi.publishPost = origPublish;
    }
  }
});

test("publishDuePosts: after the retry limit a transient error fails the post with the stored reason", async () => {
  // publish_attempts = 1 means this claim is the post's second (and last)
  // attempt — another transient error must resolve to 'failed', not loop.
  const fake = makeSocialDb({
    posts: [
      {
        post_id: "p1",
        brand_id: "b1",
        platform: "facebook",
        post_content: "still flaky",
        publish_attempts: 1,
      },
    ],
  });

  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async () => {
    throw Object.assign(new Error("503 Service Unavailable"), { statusCode: 503 });
  };

  try {
    const summary = await publishDuePosts();

    assert.deepStrictEqual(fake.state.retried, [], "no third attempt is allowed");
    assert.deepStrictEqual(fake.state.failed, ["p1"]);
    assert.match(
      JSON.parse(fake.state.failedErrors[0]).error,
      /503/,
      "the stored reason must carry the platform error",
    );
    assert.deepStrictEqual(summary, { due: 1, published: 0 });
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

test("publishDuePosts: hard errors (expired token, rejected content) fail immediately — never retried", async () => {
  // A 4xx means the platform rejected the request outright; retrying the same
  // payload can't succeed and would just delay the owner seeing the reason.
  const fake = makeSocialDb({
    posts: [
      {
        post_id: "p1",
        brand_id: "b1",
        platform: "facebook",
        post_content: "rejected",
        publish_attempts: 0,
      },
    ],
  });

  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async () => {
    throw Object.assign(new Error("401 token expired"), { statusCode: 401 });
  };

  try {
    const summary = await publishDuePosts();

    assert.deepStrictEqual(fake.state.retried, [], "hard errors must never re-queue");
    assert.deepStrictEqual(fake.state.failed, ["p1"]);
    assert.match(JSON.parse(fake.state.failedErrors[0]).error, /token expired/);
    assert.deepStrictEqual(summary, { due: 1, published: 0 });
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

test("publishDuePosts: a missing platform post id is a hard failure — the publish may have gone out, so no retry", async () => {
  // publishStoredPost throws AFTER the platform call when no external id came
  // back. That error has no transient signal, and retrying it could
  // double-post — it must take the 'failed' path even on attempt 1.
  const fake = makeSocialDb({
    posts: [
      {
        post_id: "p1",
        brand_id: "b1",
        platform: "facebook",
        post_content: "no id back",
        publish_attempts: 0,
      },
    ],
  });

  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async () => ({ externalId: null });

  try {
    await publishDuePosts();

    assert.deepStrictEqual(fake.state.retried, [], "must not risk a double-post");
    assert.deepStrictEqual(fake.state.failed, ["p1"]);
    assert.match(JSON.parse(fake.state.failedErrors[0]).error, /did not return a post id/i);
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

// --- Follow-up touchpoints (every 5 minutes) -----------------------------------

/**
 * In-memory stand-ins for db.query + db.getClient covering
 * executeDueTouchpoints. Touchpoint 1's claim (the first per-item query,
 * inside executeOneTouchpoint's transaction) throws a hard db failure that
 * rethrows into the loop's per-touchpoint guard. Touchpoint 2's email send
 * dies at the (stubbed) SMTP layer — contained at the delivery level and
 * recorded as failed. Touchpoint 3 must still deliver for real. Every
 * unrecognized query throws.
 */
function makeTouchpointDb(seed) {
  const state = { terminalUpdates: [], released: 0 };

  async function clientQuery(sql, params = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [] };

    // 1) The per-touchpoint claim — throws for the broken touchpoint.
    if (/FROM sequence_touchpoints t/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      const id = params[0];
      if ((seed.failClaimFor || []).includes(id)) {
        throw new Error(`sequence_touchpoints unreadable for ${id}`);
      }
      const tp = seed.touchpoints[id];
      return { rows: tp ? [{ ...tp }] : [] };
    }

    // 2) Lead + brand read.
    if (/FROM leads l/i.test(sql) && /JOIN brands b/i.test(sql)) {
      const lead = seed.leads[params[0]];
      return { rows: lead ? [{ ...lead }] : [] };
    }

    // 3) Terminal status write — the proof a touchpoint was executed.
    if (/UPDATE sequence_touchpoints/i.test(sql) && /SET status = \$1/i.test(sql)) {
      state.terminalUpdates.push({ id: params[2], status: params[0] });
      return { rows: [] };
    }

    // 4) Sequence progress bookkeeping.
    if (/UPDATE follow_up_sequences SET current_step/i.test(sql)) return { rows: [] };
    if (/SELECT 1 FROM sequence_touchpoints/i.test(sql) && /status = 'pending'/i.test(sql)) {
      return { rows: [{}] }; // more pending — no completion update
    }

    throw new Error(`makeTouchpointDb: unexpected client query: ${sql.slice(0, 80)}`);
  }

  async function query(sql) {
    // Discovery (the run's first, unguarded query).
    if (/FROM sequence_touchpoints t/i.test(sql) && /JOIN follow_up_sequences s/i.test(sql)) {
      return { rows: seed.due.map((touchpoint_id) => ({ touchpoint_id })) };
    }
    throw new Error(`makeTouchpointDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  async function getClient() {
    return {
      query: clientQuery,
      release: () => {
        state.released += 1;
      },
    };
  }

  return { query, getClient, state };
}

test("executeDueTouchpoints: touchpoint 1's hard failure never stops the rest of the tick", async () => {
  const fake = makeTouchpointDb({
    due: ["t1", "t2", "t3"],
    failClaimFor: ["t1"],
    touchpoints: {
      t2: {
        touchpoint_id: "t2",
        sequence_id: "s2",
        step_number: 1,
        channel: "email",
        subject: "Checking in",
        body: "Hi there",
        brand_id: "b2",
        lead_id: "l2",
      },
      t3: {
        touchpoint_id: "t3",
        sequence_id: "s3",
        step_number: 1,
        channel: "email",
        subject: "Checking in",
        body: "Hi there",
        brand_id: "b3",
        lead_id: "l3",
      },
    },
    leads: {
      l2: {
        lead_id: "l2",
        lead_name: "Broken Send",
        email: "broken@example.com",
        phone: null,
        brand_id: "b2",
        brand_name: "Broken Co",
      },
      l3: {
        lead_id: "l3",
        lead_name: "Fine Lead",
        email: "fine@example.com",
        phone: null,
        brand_id: "b3",
        brand_name: "Fine Co",
      },
    },
  });

  const mailedTo = [];
  const origQuery = db.query;
  const origGetClient = db.getClient;
  const origSendMail = sendMailImpl;
  db.query = fake.query;
  db.getClient = fake.getClient;
  // Touchpoint 2's email dies at the SMTP layer; touchpoint 3's goes through.
  sendMailImpl = async (message) => {
    mailedTo.push(message.to);
    if (message.to === "broken@example.com") {
      throw new Error("SMTP exploded for Broken Send");
    }
    return { messageId: "m1" };
  };

  try {
    // Must resolve — t1's hard throw is contained by the per-touchpoint guard.
    const processed = await executeDueTouchpoints();

    // t1 never recorded a terminal status (its claim blew up)...
    assert.ok(
      !fake.state.terminalUpdates.some((u) => u.id === "t1"),
      "the broken touchpoint must not record a terminal status",
    );
    // ...t2's send failure was contained and recorded as failed...
    // ...and t3 still delivered for real.
    assert.deepStrictEqual(
      fake.state.terminalUpdates,
      [
        { id: "t2", status: "failed" },
        { id: "t3", status: "sent" },
      ],
      "every following touchpoint must still execute after t1 throws",
    );
    assert.deepStrictEqual(
      mailedTo,
      ["broken@example.com", "fine@example.com"],
      "both remaining touchpoints must attempt delivery in order",
    );
    // t2 and t3 were processed; the broken t1 was not.
    assert.strictEqual(processed, 2);
    // Every claimed client was released, including the broken one's.
    assert.strictEqual(fake.state.released, 3, "every db client must be released");
  } finally {
    db.query = origQuery;
    db.getClient = origGetClient;
    sendMailImpl = origSendMail;
  }
});

// --- Drip emails (hourly) -------------------------------------------------------

/**
 * In-memory stand-ins for db.query + db.getClient covering sendDueDripEmails.
 * Recipient 1's claim throws a hard db failure into the loop's per-recipient
 * guard; recipient 2's send dies at the (stubbed) SMTP layer, so its
 * transaction rolls back and the row stays pending for the next tick;
 * recipient 3's email must still send and advance. Every unrecognized query
 * throws.
 */
function makeDripDb(seed) {
  const state = { sentRecipients: [], campaignIncrements: [], rollbacks: 0 };

  async function clientQuery(sql, params = []) {
    const bare = sql.trim();
    if (/^ROLLBACK$/i.test(bare)) {
      state.rollbacks += 1;
      return { rows: [] };
    }
    if (/^(BEGIN|COMMIT)$/i.test(bare)) return { rows: [] };

    // 1) The per-recipient claim — throws for the broken recipient.
    if (/FROM email_marketing_recipients r/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      const id = params[0];
      if ((seed.failClaimFor || []).includes(id)) {
        throw new Error(`email_marketing_recipients unreadable for ${id}`);
      }
      const rec = seed.recipients[id];
      return { rows: rec ? [{ ...rec }] : [] };
    }

    // 2) Opt-out check (nobody has opted out).
    if (/FROM email_opt_outs/i.test(sql)) return { rows: [] };

    // 3) Sequence emails: one final step at the current position.
    if (/FROM email_marketing_emails/i.test(sql)) {
      return {
        rows: [
          {
            sequence_position: 1,
            subject_line: "Day 1",
            body_html: "<p>Hello!</p>",
            send_delay_days: 0,
          },
        ],
      };
    }

    // 4) Completion write — the proof a recipient's email fully sent.
    if (
      /UPDATE email_marketing_recipients/i.test(sql) &&
      /delivery_status = 'sent'/i.test(sql)
    ) {
      state.sentRecipients.push(params[1]);
      return { rows: [] };
    }

    // 5) Campaign counter bump.
    if (/UPDATE email_marketing_campaigns/i.test(sql) && /sent_count/i.test(sql)) {
      state.campaignIncrements.push(params[0]);
      return { rows: [] };
    }

    throw new Error(`makeDripDb: unexpected client query: ${sql.slice(0, 80)}`);
  }

  async function query(sql) {
    // Discovery (the run's first, unguarded query).
    if (
      /FROM email_marketing_recipients r/i.test(sql) &&
      /JOIN email_marketing_campaigns c/i.test(sql)
    ) {
      return { rows: seed.due.map((recipient_id) => ({ recipient_id })) };
    }
    throw new Error(`makeDripDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  async function getClient() {
    return { query: clientQuery, release: () => {} };
  }

  return { query, getClient, state };
}

test("sendDueDripEmails: recipient 1's failure never stops the following emails", async () => {
  const fake = makeDripDb({
    due: ["r1", "r2", "r3"],
    failClaimFor: ["r1"],
    recipients: {
      r2: {
        recipient_id: "r2",
        campaign_id: "c2",
        email_address: "broken@example.com",
        current_step: 1,
        brand_id: "b2",
      },
      r3: {
        recipient_id: "r3",
        campaign_id: "c3",
        email_address: "fine@example.com",
        current_step: 1,
        brand_id: "b3",
      },
    },
  });

  const mailedTo = [];
  const origQuery = db.query;
  const origGetClient = db.getClient;
  const origSendMail = sendMailImpl;
  db.query = fake.query;
  db.getClient = fake.getClient;
  // Recipient 2's email dies at the SMTP layer; recipient 3's goes through.
  sendMailImpl = async (message) => {
    mailedTo.push(message.to);
    if (message.to === "broken@example.com") {
      throw new Error("SMTP exploded for broken@example.com");
    }
    return { messageId: "m2" };
  };

  try {
    // Must resolve — r1's hard throw is contained by the per-recipient guard.
    const summary = await sendDueDripEmails();

    // r1 never sent anything; r2's failed send rolled back (stays pending)...
    assert.ok(
      !fake.state.sentRecipients.includes("r1") && !fake.state.sentRecipients.includes("r2"),
      "broken recipients must not be marked sent",
    );
    // ...and r3's email still went out, advanced, and counted.
    assert.deepStrictEqual(
      fake.state.sentRecipients,
      ["r3"],
      "the next recipient's email must still send after earlier failures",
    );
    assert.deepStrictEqual(
      fake.state.campaignIncrements,
      ["c3"],
      "only the delivered email may bump its campaign's sent count",
    );
    assert.deepStrictEqual(
      mailedTo,
      ["broken@example.com", "fine@example.com"],
      "both claimable recipients must attempt delivery in order",
    );
    // r2 + r3 were claimed/processed; r2's send failure and r1's hard throw
    // each rolled their transactions back.
    assert.deepStrictEqual(summary, { processed: 2, sent: 1 });
    assert.ok(fake.state.rollbacks >= 2, "failed items must roll back their transactions");
  } finally {
    db.query = origQuery;
    db.getClient = origGetClient;
    sendMailImpl = origSendMail;
  }
});
