/**
 * AI Image Prompt Engineer agent for Zorecho's Image Studio.
 *
 * Where `imagePromptBuilder.js` assembles a single DALL-E prompt directly from a
 * brand + description, this agent uses Anthropic to first design FIVE distinct,
 * highly detailed, on-brand image-generation prompts. Each prompt specifies the
 * visual style, color palette, composition, mood, lighting, and any text-overlay
 * suggestions so the downstream image model produces consistent, professional,
 * on-brand marketing visuals every time.
 *
 * Output is validated before returning. Callers map upstream provider failures
 * (billing/rate/etc.) to 502 and reject empty/malformed responses (no mocks, no
 * placeholder data). Parse/shape failures are tagged `err.aiInvalid = true` so
 * the controller maps them to 502 rather than a generic 500.
 */

const { anthropic, MODEL } = require("../config/anthropic");
const { purposeMeta } = require("./imagePromptBuilder");
const { sageBlock } = require("../utils/sageContext");

const NUM_PROMPTS = 5;

function describeField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  if (typeof value === "object") {
    const parts = [];
    if (value.description) parts.push(value.description);
    if (value.style) parts.push(`style: ${value.style}`);
    if (value.mood) parts.push(`mood: ${value.mood}`);
    if (value.palette) {
      const palette = Array.isArray(value.palette)
        ? value.palette.join(", ")
        : value.palette;
      if (palette) parts.push(`palette: ${palette}`);
    }
    if (value.colors) {
      const colors = Array.isArray(value.colors)
        ? value.colors.join(", ")
        : value.colors;
      if (colors) parts.push(`colors: ${colors}`);
    }
    if (value.demographics) parts.push(value.demographics);
    if (Array.isArray(value.interests) && value.interests.length) {
      parts.push(`interests: ${value.interests.join(", ")}`);
    }
    return parts.length ? parts.join("; ") : fallback;
  }
  return fallback;
}

/**
 * Flattens a brand's stored visual profile into a plain summary for the Brand
 * Style Guide tab. Non-AI — purely reads the brand-discovery fields.
 */
function buildBrandStyleSummary(brand) {
  const visual = brand.visual_style_preferences;
  let palette = [];
  let visualStyle = "";
  let mood = "";
  if (visual && typeof visual === "object" && !Array.isArray(visual)) {
    if (Array.isArray(visual.palette)) palette = visual.palette.filter(Boolean);
    else if (typeof visual.palette === "string" && visual.palette.trim()) {
      palette = [visual.palette.trim()];
    }
    visualStyle = visual.description || visual.style || "";
    mood = visual.mood || "";
  } else if (typeof visual === "string") {
    visualStyle = visual;
  }

  return {
    palette,
    visualStyle,
    mood,
    personality: brand.brand_personality || "",
    voice: brand.voice_description || "",
    audience: describeField(brand.target_audience, ""),
  };
}

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the image prompts from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function buildSystemPrompt(brand, purpose, contentDescription) {
  const meta = purposeMeta(purpose);
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and trustworthy";
  const voice = brand.voice_description || "clear, confident, benefit-focused";
  const visualStyle = describeField(
    brand.visual_style_preferences,
    "modern, clean, professional"
  );
  const audience = describeField(brand.target_audience, "a general audience");

  return [
    "You are Zorecho's AI Image Prompt Engineer — an expert at writing prompts for AI image generators (DALL-E 3) that consistently produce professional, marketing-quality, on-brand visuals.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Visual style preferences: ${visualStyle}`,
    `- Target audience: ${audience}`,
    "",
    `Image purpose: ${meta.label} (${meta.aspect}, optimized for ${meta.platform}).`,
    `Content brief: ${contentDescription}`,
    sageBlock(brand._sageContext),
    "",
    `Design EXACTLY ${NUM_PROMPTS} distinct image-generation prompts. Each must be a complete, ready-to-use prompt that explicitly specifies:`,
    "- the visual style,",
    "- the color palette (aligned to the brand's colors/mood),",
    "- the composition and framing,",
    "- the mood/emotion,",
    "- the lighting,",
    "- and a brief text-overlay suggestion (describe placement/copy intent only — instruct the generator NOT to render literal text/letters/logos in the image).",
    "",
    "All five must feel cohesively on-brand but explore five different creative directions.",
    "",
    "Return ONLY a JSON array (no prose, no markdown fences) of exactly 5 objects, each with these keys:",
    '- "style": a short label for the creative direction (e.g. "Minimal & airy").',
    '- "prompt": the full, detailed image-generation prompt described above.',
    '- "styleNotes": one short line summarizing the palette, mood, and lighting.',
  ].join("\n");
}

function normalizePrompt(raw) {
  if (!raw || typeof raw !== "object") return null;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return null;
  return {
    style: typeof raw.style === "string" ? raw.style.trim() : "",
    prompt,
    styleNotes: typeof raw.styleNotes === "string" ? raw.styleNotes.trim() : "",
  };
}

/**
 * Generates exactly NUM_PROMPTS detailed, on-brand image-generation prompts.
 * Returns [{ style, prompt, styleNotes }]. Throws (err.aiInvalid) on malformed
 * output; the OpenAI/Anthropic SDK throws on upstream failures.
 */
async function generateImagePrompts(brand, purpose, contentDescription) {
  const systemPrompt = buildSystemPrompt(brand, purpose, contentDescription);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Design ${NUM_PROMPTS} on-brand image prompts for: ${contentDescription}. Respond with only the JSON array.`,
      },
    ],
  });

  const text = extractText(response);
  let prompts;
  try {
    const raw = extractJsonArray(text);
    if (!Array.isArray(raw)) {
      throw new Error("The AI response was not a JSON array of image prompts");
    }
    prompts = raw.map(normalizePrompt).filter(Boolean);
  } catch (err) {
    err.aiInvalid = true;
    throw err;
  }
  if (prompts.length < NUM_PROMPTS) {
    const err = new Error(
      `The AI returned only ${prompts.length} of ${NUM_PROMPTS} required image prompts`
    );
    err.aiInvalid = true;
    throw err;
  }
  return prompts.slice(0, NUM_PROMPTS);
}

module.exports = {
  NUM_PROMPTS,
  buildBrandStyleSummary,
  buildSystemPrompt,
  generateImagePrompts,
};
