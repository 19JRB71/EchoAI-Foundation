#!/usr/bin/env node
/**
 * scripts/stagingProof.js — Prompt 006 external-proof runner (CLI).
 *
 * Drives the staging API end to end; all provider mutations happen INSIDE the
 * deployed staging app through its real machinery (schedulePost →
 * publishPostNow → staging-proof record/read-back/delete → sendEmail). This
 * script holds no provider credentials — only a staging admin session.
 *
 * Two-stage live-action control (owner term 9):
 *   node scripts/stagingProof.js preflight --brand <id> --to <email> --run-key <key>
 *     Read-only report (Page id + name, tenant, SMTP state, proposed post
 *     text, existing proof rows). NO provider mutation. STOP for owner
 *     approval before ever calling `run`.
 *   node scripts/stagingProof.js run --brand <id> --to <email> --run-key <key> [--text "..."]
 *     Fires the two real actions (one FB text post published then deleted,
 *     one email) and prints every provider response verbatim (server-side
 *     redaction strips credentials).
 *
 * Idempotency (owner term 12): the run key is the unit of retry. Before
 * publishing, the runner checks existing proof rows for the key — if a
 * publish row exists it resumes read-back/delete on THAT post id instead of
 * publishing again. Duplicate rows are impossible ((run_key, provider,
 * action) is unique).
 *
 * Environment (never printed): STAGING_BASE_URL (default
 * https://staging.zorecho.com), STAGING_ADMIN_EMAIL, STAGING_ADMIN_PASSWORD.
 */

const BASE = process.env.STAGING_BASE_URL || "https://staging.zorecho.com";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith("--")) {
      args[rest[i].slice(2)] = rest[i + 1];
      i += 1;
    }
  }
  return args;
}

async function api(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_e) {
    data = { raw: text };
  }
  return { status: response.status, data };
}

async function login() {
  const email = process.env.STAGING_ADMIN_EMAIL;
  const password = process.env.STAGING_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD must be set");
  }
  const { status, data } = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (status !== 200 || !data.token) {
    throw new Error(`Staging login failed (HTTP ${status})`);
  }
  return data.token;
}

function print(label, payload) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(payload, null, 2));
}

async function preflight(args, token) {
  const query = new URLSearchParams({
    brandId: args.brand,
    ...(args["run-key"] ? { runKey: args["run-key"] } : {}),
    ...(args.to ? { to: args.to } : {}),
  });
  const { status, data } = await api(`/api/staging-proof/preflight?${query}`, { token });
  print(`PREFLIGHT (HTTP ${status}) — READ-ONLY, no provider mutation`, data);
  if (status !== 200) process.exitCode = 1;
  console.log(
    "\nSTOP: obtain explicit owner approval of the Page, recipient and post text above before running `run`."
  );
}

async function run(args, token) {
  const runKey = args["run-key"];
  const brandId = args.brand;
  const to = args.to;
  if (!runKey || !brandId || !to) {
    throw new Error("run requires --brand, --to and --run-key");
  }

  // Existing evidence (informational — resume state).
  const existing = await api(`/api/staging-proof/runs/${encodeURIComponent(runKey)}`, { token });
  print(`EXISTING PROOF ROWS for ${runKey} (HTTP ${existing.status})`, existing.data);

  // 1. Claim THE post for this run (atomic, server-side, bound to the run key
  // BEFORE any publish — a retry always converges on this same row, so a
  // second live post is impossible even after a crash mid-run).
  const claim = await api("/api/staging-proof/post", {
    method: "POST",
    token,
    body: { runKey, brandId, ...(args.text ? { text: args.text } : {}) },
  });
  print(`CLAIM PROOF POST (HTTP ${claim.status})`, claim.data);
  if (claim.status !== 200) {
    throw new Error("Claiming the proof post failed — stopping before any provider mutation");
  }
  const postId = claim.data.post.post_id;

  // 2. Publish through the REAL machinery — only if not already published.
  if (claim.data.post.status === "scheduled") {
    const published = await api(`/api/social/posts/${postId}/publish-now`, {
      method: "POST",
      token,
    });
    print(`PUBLISH NOW via publishPostNow (HTTP ${published.status})`, published.data);
    if (published.status !== 200) {
      throw new Error("Publish failed — provider response above is verbatim; no proof rows written");
    }
  } else {
    console.log(
      `\nResuming run ${runKey}: post is '${claim.data.post.status}' (external id ${claim.data.post.external_post_id || "n/a"}); NOT publishing again.`
    );
  }

  // 3. Record publish evidence + Graph read-back + delete (server-side).
  const fb = await api("/api/staging-proof/facebook", {
    method: "POST",
    token,
    body: { runKey, postId },
  });
  print(`FACEBOOK PROOF STAGES (HTTP ${fb.status})`, fb.data);
  if (fb.status !== 200) {
    throw new Error(
      "Facebook proof run incomplete — completed stages and the live post id (if any) are shown verbatim above. Re-run with the same --run-key to resume cleanup."
    );
  }

  // 4. One proof email through the app's real transport.
  const email = await api("/api/staging-proof/email", {
    method: "POST",
    token,
    body: { runKey, to, brandId },
  });
  print(`EMAIL PROOF (HTTP ${email.status})`, email.data);
  if (email.status !== 200) {
    throw new Error("Email proof failed — provider response above is verbatim");
  }

  // 5. Final evidence listing.
  const final = await api(`/api/staging-proof/runs/${encodeURIComponent(runKey)}`, { token });
  print(`FINAL PROOF ROWS for ${runKey} (HTTP ${final.status})`, final.data);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!["preflight", "run"].includes(args.command)) {
    console.error(
      "Usage: node scripts/stagingProof.js <preflight|run> --brand <brandId> --to <email> --run-key <key> [--text \"...\"]"
    );
    process.exit(1);
  }
  try {
    const token = await login();
    if (args.command === "preflight") await preflight(args, token);
    else await run(args, token);
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    process.exit(1);
  }
})();
