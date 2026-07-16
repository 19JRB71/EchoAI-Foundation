/**
 * Vision — Zorecho's Visual Intelligence Agent (Phase 1).
 *
 * Vision studies the visual marketing landscape for each brand and maintains
 * a growing, versioned visual knowledge base for that brand's industry so
 * Forge can create more realistic, higher-converting, completely original
 * marketing images.
 *
 * HONESTY CONTRACT (CEO-approved, July 2026):
 * - Vision studies ONLY sources we legitimately have. Phase 1 sources are the
 *   SOURCE_REGISTRY below: Scout's competitor Facebook ads (text + metadata
 *   already collected by Ad Spy) and the brand's own Zorecho image library.
 * - Every study run records exactly which sources contributed and how many
 *   rows. Vision never claims to have monitored a source it can't reach.
 * - Vision's industry expertise (what a professionally built pole barn should
 *   look like, correct proportions, lighting, composition) is distilled from
 *   Claude's built-in knowledge and is labeled as such — not passed off as
 *   scraped data.
 * - Vision never copies another company's artwork, logos, or watermarks. Its
 *   output is conceptual guidance (principles, proportions, composition),
 *   never reproductions.
 *
 * Future sources (official APIs, customer-authorized connections) plug into
 * SOURCE_REGISTRY without redesign: add { key, label, gather(brand) }.
 */

const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const visionFiles = require("./visionFiles");

// Owner-uploaded reference photos live here (served at /uploads/vision/).
const REFERENCE_DIR = path.join(__dirname, "..", "uploads", "vision");
// How many reference photos Claude actually looks at per study run (newest
// first). Anthropic accepts up to ~100 images / 5 MB each; we stay well under.
const MAX_REFERENCE_PHOTOS_PER_STUDY = 10;

// Heavy distillation call — same budget class as other long generations.
const STUDY_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Source registry (pluggable). Each gather() returns { count, items } where
// items are compact text observations. Failures throw — the study run records
// the source as unavailable rather than silently pretending it was studied.
// ---------------------------------------------------------------------------
const SOURCE_REGISTRY = [
  {
    key: "competitor_facebook_ads",
    label: "Competitor Facebook ads (via Scout's Ad Spy)",
    async gather(brand) {
      const r = await db.query(
        `SELECT competitor_name, headline, body_text, cta_text, platforms,
                threat_level, delivery_start, last_seen_at
         FROM competitor_ads
         WHERE brand_id = $1
         ORDER BY last_seen_at DESC
         LIMIT 40`,
        [brand.brand_id]
      );
      return {
        count: r.rows.length,
        items: r.rows.map((a) =>
          [
            `Competitor "${a.competitor_name}" ad`,
            a.headline ? `headline: ${a.headline}` : "",
            a.body_text ? `body: ${String(a.body_text).slice(0, 240)}` : "",
            a.cta_text ? `CTA: ${a.cta_text}` : "",
            Array.isArray(a.platforms) && a.platforms.length
              ? `platforms: ${a.platforms.join(", ")}`
              : "",
            a.threat_level ? `threat read: ${a.threat_level}` : "",
          ]
            .filter(Boolean)
            .join(" | ")
        ),
      };
    },
  },
  {
    key: "brand_image_library",
    label: "This brand's own Zorecho image library",
    async gather(brand) {
      const r = await db.query(
        `SELECT purpose, prompt_used, platform, status, created_at
         FROM images
         WHERE brand_id = $1
         ORDER BY created_at DESC
         LIMIT 40`,
        [brand.brand_id]
      );
      return {
        count: r.rows.length,
        items: r.rows.map(
          (i) =>
            `Own image (${i.purpose}${i.platform ? `, ${i.platform}` : ""}, ${i.status}): prompt was "${String(i.prompt_used || "").slice(0, 240)}"`
        ),
      };
    },
  },
  {
    key: "brand_reference_photos",
    label: "Owner-uploaded reference photos (real products / completed work)",
    async gather(brand) {
      const r = await db.query(
        `SELECT file_path, original_name, mime_type, caption, created_at
         FROM vision_reference_images
         WHERE brand_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [brand.brand_id, MAX_REFERENCE_PHOTOS_PER_STUDY]
      );
      const items = [];
      const imageBlocks = [];
      let unreadable = 0;
      for (const row of r.rows) {
        // file_path is a relative URL like /uploads/vision/<name>; resolve the
        // basename inside REFERENCE_DIR only (never trust the stored path as a
        // filesystem path).
        try {
          const photo = await visionFiles.readReferencePhoto(row.file_path, row.mime_type);
          if (!photo) throw new Error("no disk file and no stored bytes");
          imageBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: photo.mime,
              data: photo.buffer.toString("base64"),
            },
          });
          items.push(
            `Reference photo ${imageBlocks.length} ("${row.original_name}"${row.caption ? `, owner's note: ${String(row.caption).slice(0, 200)}` : ""}) — attached as image ${imageBlocks.length} for you to study.`
          );
        } catch {
          unreadable += 1;
        }
      }
      if (unreadable) {
        items.push(
          `${unreadable} uploaded photo(s) could not be read from storage this run and were NOT studied.`
        );
      }
      // count = photos Claude actually saw this run (honest, not rows in DB).
      return { count: imageBlocks.length, items, imageBlocks };
    },
  },
];

// ---------------------------------------------------------------------------
// Study one brand: gather real sources → Claude distills → versioned upsert.
// ---------------------------------------------------------------------------

function buildStudyPrompt({ industry, brand, prior, sources }) {
  const sourceBlocks = sources
    .map((s) => {
      if (s.error) return `## ${s.label}\nUNAVAILABLE this run (${s.error}). Do not draw conclusions from it.`;
      if (!s.count) return `## ${s.label}\nNo rows available this run.`;
      return `## ${s.label} (${s.count} real observations)\n${s.items.join("\n")}`;
    })
    .join("\n\n");

  return [
    `You are Vision, Zorecho's Visual Intelligence Agent. You are building a growing visual knowledge base for the "${industry}" industry so Forge (the Creative Director agent) can generate more realistic, higher-converting, completely original marketing images for the brand "${brand.brand_name}".`,
    "",
    "Rules:",
    "- Base observational claims ONLY on the real observations below; never invent data from sources you were not given.",
    "- Your deep built-in expertise about this industry's visual standards (correct structural proportions, materials, typical settings, composition, lighting, seasonal looks, customer emotions) IS a legitimate input — use it fully, it is labeled as expert knowledge, not observation.",
    "- If reference photos are attached to this message, they are REAL photos of this brand's own products / completed work, uploaded by the owner. Study them closely: actual materials, proportions, colors, finish quality, settings. What you see in them outranks generic industry assumptions. If a photo is too blurry, dark, or irrelevant to learn from, say so honestly in the summary instead of pretending to learn from it.",
    "- Never describe copying any company's artwork, logo, or watermark. Output is conceptual guidance only.",
    prior
      ? `\nYour PRIOR knowledge base (version ${prior.version}, refine and grow it — keep what is still true, improve weak areas):\n${JSON.stringify(prior.knowledge).slice(0, 6000)}`
      : "\nThis is your FIRST study of this brand — build the initial knowledge base.",
    "",
    "Real observations gathered this run:",
    sourceBlocks,
    "",
    "Return ONLY a JSON object (no prose, no markdown fences) with keys:",
    '- "structural_standards": array of strings — what products/buildings/work in this industry should actually look like (proportions, materials, construction details, realistic dimensions).',
    '- "composition": array of strings — camera angles, framing, and staging that work for this industry\'s marketing.',
    '- "lighting": array of strings — lighting approaches that make this industry\'s work look professional.',
    '- "color_palettes": array of strings — palettes that convert in this industry.',
    '- "seasonal_trends": array of strings — how imagery should shift through the year.',
    '- "customer_emotions": array of strings — emotions winning imagery evokes in this industry\'s buyers.',
    '- "market_observations": array of strings — patterns seen in the REAL observations above (offers, messaging, frequency). Empty array if no observations were available.',
    '- "avoid": array of strings — dated or low-converting visual styles to avoid.',
    '- "summary": one short paragraph (plain English, for the owner) of what you learned or refined this run.',
    '- "confidence": integer 0-100 — how confident you are in this knowledge base overall (more real observations and more studies = higher).',
  ].join("\n");
}

function extractText(response) {
  if (!response || !Array.isArray(response.content)) return "";
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function parseKnowledge(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Vision AI response contained no JSON object");
  const obj = JSON.parse(text.slice(start, end + 1));
  const arrays = [
    "structural_standards",
    "composition",
    "lighting",
    "color_palettes",
    "seasonal_trends",
    "customer_emotions",
    "market_observations",
    "avoid",
  ];
  for (const k of arrays) {
    if (!Array.isArray(obj[k])) obj[k] = [];
    obj[k] = obj[k].map((s) => String(s)).filter((s) => s.trim());
  }
  if (!arrays.some((k) => obj[k].length)) {
    throw new Error("Vision AI response contained an empty knowledge base");
  }
  obj.summary = String(obj.summary || "").trim();
  if (!obj.summary) throw new Error("Vision AI response was missing the summary");
  let conf = Number(obj.confidence);
  if (!Number.isFinite(conf)) conf = 0;
  obj.confidence = Math.max(0, Math.min(100, Math.round(conf)));
  return obj;
}

/**
 * Runs one study for a brand. Creates a vision_study_runs row up front and
 * always finalizes it (completed/failed) with honest source counts.
 * Returns the run outcome; throws only on unexpected DB failures before the
 * run row exists.
 */
async function studyBrand(brand, { trigger = "scheduled" } = {}) {
  const industry = String(brand.industry || "").trim() || "general local business";

  // Atomic per-brand claim: only one study may run at a time for a brand, so
  // an overlapping manual "Study now" + scheduled sweep can't double-spend AI
  // or race last-write-wins on the knowledge row. A running claim older than
  // 15 minutes (3x the 5-minute AI timeout) is treated as dead and reclaimable.
  const runIns = await db.query(
    `INSERT INTO vision_study_runs (brand_id, trigger)
     SELECT $1, $2
     WHERE NOT EXISTS (
       SELECT 1 FROM vision_study_runs
       WHERE brand_id = $1
         AND status = 'running'
         AND started_at > NOW() - INTERVAL '15 minutes'
     )
     RETURNING run_id`,
    [brand.brand_id, trigger]
  );
  if (!runIns.rows.length) {
    return { status: "skipped", reason: "a study is already running for this brand" };
  }
  const runId = runIns.rows[0].run_id;

  const sources = [];
  const sourceCounts = {};
  const imageBlocks = [];
  for (const src of SOURCE_REGISTRY) {
    try {
      const got = await src.gather(brand);
      sources.push({ key: src.key, label: src.label, count: got.count, items: got.items });
      sourceCounts[src.key] = got.count;
      if (Array.isArray(got.imageBlocks)) imageBlocks.push(...got.imageBlocks);
    } catch (err) {
      // Honest: record the source as unavailable, never fabricate.
      sources.push({ key: src.key, label: src.label, count: 0, items: [], error: err.message });
      sourceCounts[src.key] = null; // null = could not be read this run
    }
  }

  try {
    const priorRes = await db.query(
      `SELECT knowledge, version FROM vision_knowledge WHERE brand_id = $1`,
      [brand.brand_id]
    );
    const prior = priorRes.rows[0] || null;

    const response = await createMessage(
      {
        model: MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            // Owner-uploaded reference photos are attached as real image
            // blocks so Claude genuinely looks at them; the prompt text
            // references them by number.
            content: [
              ...imageBlocks,
              {
                type: "text",
                text: buildStudyPrompt({ industry, brand, prior, sources }),
              },
            ],
          },
        ],
      },
      { timeout: STUDY_TIMEOUT_MS, label: "Vision study", feature: "vision-study" }
    );

    const learned = parseKnowledge(extractText(response));
    const { summary, confidence, ...knowledge } = learned;

    await db.query(
      `INSERT INTO vision_knowledge
         (brand_id, industry, knowledge, confidence, version, sources_studied, last_studied_at)
       VALUES ($1, $2, $3::jsonb, $4, 1, $5::jsonb, NOW())
       ON CONFLICT (brand_id) DO UPDATE SET
         industry = EXCLUDED.industry,
         knowledge = EXCLUDED.knowledge,
         confidence = EXCLUDED.confidence,
         version = vision_knowledge.version + 1,
         sources_studied = EXCLUDED.sources_studied,
         last_studied_at = NOW(),
         updated_at = NOW()`,
      [
        brand.brand_id,
        industry,
        JSON.stringify(knowledge),
        confidence,
        JSON.stringify(sourceCounts),
      ]
    );

    await db.query(
      `UPDATE vision_study_runs
       SET status = 'completed', sources = $2::jsonb, summary = $3, finished_at = NOW()
       WHERE run_id = $1`,
      [runId, JSON.stringify(sourceCounts), summary]
    );
    return { status: "completed", runId, summary, confidence };
  } catch (err) {
    await db
      .query(
        `UPDATE vision_study_runs
         SET status = 'failed', sources = $2::jsonb, error = $3, finished_at = NOW()
         WHERE run_id = $1`,
        [runId, JSON.stringify(sourceCounts), String(err.message || err).slice(0, 500)]
      )
      .catch(() => {});
    return { status: "failed", runId, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Daily sweep — study every real (non-demo) brand. Per-brand guard so one
// failure never stops the loop; demo brands are excluded at the query.
// ---------------------------------------------------------------------------
async function runDailyVisionStudy() {
  const brands = await db.query(
    `SELECT b.brand_id, b.brand_name, u.industry
     FROM brands b
     JOIN users u ON u.user_id = b.user_id
     WHERE COALESCE(b.is_demo, false) = false`
  );
  let studied = 0;
  let failed = 0;
  for (const brand of brands.rows) {
    try {
      const out = await module.exports.studyBrand(brand, { trigger: "scheduled" });
      if (out.status === "completed") studied += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`Vision study failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  if (brands.rows.length) {
    console.log(`Vision daily study: ${studied} completed, ${failed} failed of ${brands.rows.length} brands`);
  }
}

// ---------------------------------------------------------------------------
// Guidance for Forge — consult before generating any image. Fail-open: any
// error returns null so image generation is NEVER blocked by Vision.
// ---------------------------------------------------------------------------

function knowledgeToGuidanceText(row) {
  const k = row.knowledge || {};
  const section = (title, arr, max) =>
    Array.isArray(arr) && arr.length
      ? `${title}:\n${arr.slice(0, max).map((s) => `- ${s}`).join("\n")}`
      : "";
  const parts = [
    `VISION — visual intelligence for the ${row.industry} industry (knowledge v${row.version}, confidence ${row.confidence}/100). Use this to make the image structurally accurate, realistic, and on-trend. Create something completely original — never copy any company's artwork.`,
    section("Structural accuracy (what it must actually look like)", k.structural_standards, 8),
    section("Composition that converts", k.composition, 5),
    section("Lighting", k.lighting, 4),
    section("Color palettes", k.color_palettes, 4),
    section("Seasonal note", k.seasonal_trends, 3),
    section("Emotions to evoke", k.customer_emotions, 4),
    section("Avoid (dated / low-converting)", k.avoid, 5),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Returns { text, version } of visual guidance for an image request, logging
 * the consult, or null when no knowledge exists / anything fails.
 */
async function getGuidanceForImageRequest({ brandId, requester, requestSummary }) {
  try {
    const r = await db.query(
      `SELECT industry, knowledge, confidence, version FROM vision_knowledge WHERE brand_id = $1`,
      [brandId]
    );
    const row = r.rows[0];
    if (!row) return null;
    const text = knowledgeToGuidanceText(row);
    if (!text) return null;
    db.query(
      `INSERT INTO vision_guidance_log (brand_id, requester, request_summary, knowledge_version)
       VALUES ($1, $2, $3, $4)`,
      [brandId, requester || "forge", String(requestSummary || "").slice(0, 300), row.version]
    ).catch((err) => console.error("Vision guidance log error:", err.message));
    return { text, version: row.version, confidence: row.confidence };
  } catch (err) {
    console.error("Vision guidance error:", err.message);
    return null;
  }
}

module.exports = {
  SOURCE_REGISTRY,
  studyBrand,
  runDailyVisionStudy,
  getGuidanceForImageRequest,
  knowledgeToGuidanceText,
  parseKnowledge,
};
