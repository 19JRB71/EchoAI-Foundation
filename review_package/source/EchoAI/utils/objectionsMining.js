/**
 * Sage V2 Phase 4 — monthly customer-objections mining (SAGE_V2_TRUTH_INPUTS).
 *
 * Once a month, per real (non-demo) brand with enough closed autonomous
 * conversations, Claude distills the lead-side messages of the last 90 days
 * into AGGREGATE objection themes (paraphrased — never verbatim quotes, never
 * per-customer detail) and stores them as ONE intel item per month via the
 * canonical intel writer (dedup key objections:<YYYY-MM>, so re-runs upsert).
 *
 * Honesty rules: too little data → no-op (nothing fabricated); AI failure →
 * the job fails visibly (jobQueue marks it failed), never a placeholder.
 * Cost rules: skip-gated on an input hash of the conversation set; runs on
 * the Phase 2 job queue when enabled, direct loop otherwise.
 */

const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const aiControls = require("../config/aiControls");
const jobQueue = require("./jobQueue");
const inputHash = require("./inputHash");
const { saveFeedItem } = require("../controllers/sageController");

const MIN_CONVERSATIONS = 5;
const JOB_TYPE = "objections_mining";

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

/** Lead-side message excerpts from closed conversations in the last 90 days. */
async function gatherLeadMessages(brandId) {
  const { rows } = await db.query(
    `SELECT conversation_id, channel, close_reason, transcript
       FROM autonomous_conversations
      WHERE brand_id = $1 AND status = 'closed'
        AND created_at > NOW() - INTERVAL '90 days'
      ORDER BY created_at DESC
      LIMIT 100`,
    [brandId],
  );
  const conversations = [];
  for (const row of rows) {
    const transcript = Array.isArray(row.transcript) ? row.transcript : [];
    const leadLines = transcript
      .filter((m) => m && (m.role === "lead" || m.role === "user" || m.direction === "inbound"))
      .map((m) => String(m.text || m.content || "").trim())
      .filter(Boolean)
      .slice(0, 12);
    if (leadLines.length) {
      conversations.push({
        id: row.conversation_id,
        channel: row.channel,
        closeReason: row.close_reason || null,
        leadLines,
      });
    }
  }
  return conversations;
}

function buildPrompt(brandName, conversations) {
  const sample = conversations
    .slice(0, 60)
    .map(
      (c, i) =>
        `Conversation ${i + 1} (${c.channel}, ended: ${c.closeReason || "unknown"}):\n` +
        c.leadLines.map((l) => `  - ${l.slice(0, 300)}`).join("\n"),
    )
    .join("\n");
  return [
    `You are analyzing REAL customer conversations for the business "${brandName}".`,
    "Identify the recurring OBJECTIONS, hesitations, and concerns customers raised before buying (or before walking away).",
    "Rules:",
    "- AGGREGATE themes only. Paraphrase; NEVER quote a customer verbatim and NEVER include names, phone numbers, or emails.",
    "- Only report themes that appear more than once. If nothing recurs, return an empty array.",
    "- Base everything strictly on the messages below. Never invent an objection.",
    "",
    "Return ONLY a JSON object (no prose, no fences):",
    '{"themes":[{"theme":"<short name>","frequency":<integer count of conversations it appeared in>,"summary":"<1-2 sentence paraphrased description>"}]}',
    "",
    "Customer-side messages:",
    sample,
  ].join("\n");
}

function parseThemes(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || !Array.isArray(obj.themes)) return null;
  const themes = obj.themes
    .filter(
      (t) =>
        t &&
        typeof t.theme === "string" &&
        t.theme.trim() &&
        typeof t.summary === "string" &&
        t.summary.trim() &&
        Number.isFinite(Number(t.frequency)) &&
        Number(t.frequency) >= 2,
    )
    .map((t) => ({
      theme: t.theme.trim().slice(0, 80),
      frequency: Math.round(Number(t.frequency)),
      summary: t.summary.trim().slice(0, 400),
    }))
    .slice(0, 8);
  return themes;
}

/** Mine one brand. Returns {skipped:true} / {skipped:false, themes} shapes for the queue. */
async function mineBrandObjections(brand) {
  const conversations = await gatherLeadMessages(brand.brand_id);
  if (conversations.length < MIN_CONVERSATIONS) {
    return { skipped: true, reason: "not_enough_conversations" };
  }
  const gate = await inputHash.shouldRun(JOB_TYPE, brand.brand_id, {
    conversationIds: conversations.map((c) => c.id).sort(),
  });
  if (!gate.run) {
    await inputHash.recordRun(JOB_TYPE, brand.brand_id, gate.hash, "skipped_unchanged");
    return { skipped: true, inputHash: gate.hash };
  }

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(brand.brand_name, conversations) }],
    },
    { label: "Objections mining", feature: "objections_mining", brandId: brand.brand_id, background: true },
  );
  const text = (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const themes = parseThemes(text);
  if (themes == null) {
    const err = new Error("Objections mining returned no valid JSON themes.");
    err.aiInvalid = true;
    throw err;
  }
  if (themes.length) {
    const month = monthKey();
    const top = themes
      .map((t) => `${t.theme} (seen in ${t.frequency} conversations): ${t.summary}`)
      .join(" | ");
    await saveFeedItem(brand.brand_id, {
      source_type: "market",
      summary: `Customer objections this quarter — ${themes.length} recurring theme(s): ${top}`.slice(0, 1500),
      why_it_matters:
        "These are the real reasons leads hesitate before buying. Address the top themes in ad copy, follow-ups, and the chatbot's answers.",
      urgent: false,
      signal_key: `objections:${month}`,
      confidence: "verified",
      source: "objections_mining",
    });
  }
  await inputHash.recordRun(JOB_TYPE, brand.brand_id, gate.hash, "done");
  return { skipped: false, themeCount: themes.length, inputHash: gate.hash };
}

/**
 * Monthly sweep across all real brands. Flag-dark => no-op. Per-brand guard
 * (house sweep-guard seam): one bad brand never starves the rest.
 */
async function runMonthlyObjectionsMining() {
  if (!(await aiControls.getSwitch("SAGE_V2_TRUTH_INPUTS"))) return { skipped: "flag_off" };
  const bg = await aiControls.backgroundAiAllowedHere();
  if (!bg.allowed) {
    console.log(`Objections mining skipped: ${bg.reason}`);
    return { skipped: bg.reason };
  }
  const { rows: brands } = await db.query(
    `SELECT DISTINCT b.* FROM brands b
      JOIN autonomous_conversations ac ON ac.brand_id = b.brand_id
     WHERE b.is_demo = false AND ac.status = 'closed'
       AND ac.created_at > NOW() - INTERVAL '90 days'`,
  );
  if (!brands.length) return { processed: 0 };

  const runKey = `objections:${monthKey()}`;
  if (await jobQueue.enabled().catch(() => false)) {
    const rescued = await jobQueue.rescueStaleClaims().catch(() => []);
    if (rescued.length) {
      console.error(`Objections mining: rescued ${rescued.length} stale claim(s).`);
    }
    for (const brand of brands) {
      await jobQueue.enqueue(JOB_TYPE, brand.brand_id, runKey).catch((err) => {
        console.error(`Objections mining enqueue failed (${brand.brand_id}):`, err.message);
      });
    }
    const byId = new Map(brands.map((b) => [b.brand_id, b]));
    const processed = await jobQueue.drain(JOB_TYPE, async (job) => {
      const brand = byId.get(job.brand_id);
      if (!brand) throw new Error("Brand no longer exists");
      return mineBrandObjections(brand);
    });
    return { processed };
  }

  let processed = 0;
  for (const brand of brands) {
    try {
      await mineBrandObjections(brand);
      processed++;
    } catch (err) {
      console.error(`Objections mining failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  return { processed };
}

module.exports = {
  runMonthlyObjectionsMining,
  mineBrandObjections,
  gatherLeadMessages,
  parseThemes,
  MIN_CONVERSATIONS,
  JOB_TYPE,
};
