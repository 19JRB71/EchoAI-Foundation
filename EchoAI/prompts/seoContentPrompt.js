/**
 * AI SEO agent prompt + generators.
 *
 * - CONTENT_TYPES: the supported content formats.
 * - generateSeoContent(brand, keyword, contentType): calls Anthropic to produce
 *   a complete, SEO-optimized content package (title, meta description, header
 *   structure, body, internal links, SEO score + explanation).
 * - generateKeywordSuggestions(topic): calls Anthropic for ten related keyword
 *   ideas, each tagged with an estimated search-volume category.
 */

const { anthropic, MODEL } = require("../config/anthropic");

const CONTENT_TYPES = {
  blog_post: "blog post",
  landing_page: "landing page",
  product_description: "product description",
};

const VOLUME_CATEGORIES = ["high", "medium", "low"];

function describeAudience(targetAudience) {
  if (!targetAudience) return "the brand's ideal customers";
  if (typeof targetAudience === "string") return targetAudience;
  if (typeof targetAudience === "object") {
    return (
      targetAudience.description ||
      targetAudience.summary ||
      [targetAudience.demographics, targetAudience.interests]
        .filter(Boolean)
        .join(", ") ||
      JSON.stringify(targetAudience)
    );
  }
  return String(targetAudience);
}

/** Builds the system prompt instructing the LLM to produce SEO content. */
function buildSeoContentPrompt(brand, keyword, contentType) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, helpful, and benefit-focused";
  const audienceText = describeAudience(brand.target_audience);
  const typeLabel = CONTENT_TYPES[contentType] || "blog post";

  return [
    "You are EchoAI's SEO agent. You write content that ranks on Google AND reads like it was written by a thoughtful human expert — never keyword-stuffed or robotic.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Audience: ${audienceText}`,
    "",
    `Target keyword/topic: ${keyword}`,
    `Content type: ${typeLabel}`,
    "",
    "Write fully SEO-optimized content following on-page best practices:",
    "- A keyword-rich, compelling title (H1) that includes the target keyword naturally.",
    "- A meta description UNDER 160 characters that earns the click.",
    "- A logical header structure using H1, H2, and H3 headings.",
    "- Full body content that naturally incorporates the target keyword and semantically related terms (LSI), with real substance and value.",
    "- 3-5 internal linking suggestions (anchor text + the kind of page to link to).",
    "- An honest SEO score (0-100) and a short explanation of WHY this content will rank well.",
    "",
    "Match the brand voice and personality EXACTLY. Sound human, not like a marketing department.",
    "",
    "Return ONLY a JSON object (no prose, no markdown fences) with these keys:",
    '- "title": the H1 / page title.',
    '- "metaDescription": under 160 characters.',
    '- "headers": an array of { "level": "H1"|"H2"|"H3", "text": string } in document order.',
    '- "body": the full article body as a single string. Use \\n\\n between paragraphs and "## " / "### " markdown for section headings.',
    '- "internalLinks": an array of { "anchorText": string, "target": string }.',
    '- "relatedKeywords": an array of related terms you wove in.',
    '- "seoScore": an integer 0-100.',
    '- "seoScoreExplanation": a short paragraph explaining the score and ranking rationale.',
  ].join("\n");
}

/** Extracts a JSON object from an LLM response that may include prose/fences. */
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the SEO content from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Extracts a JSON array from an LLM response that may include prose/fences. */
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the keyword suggestions from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Generates an SEO content package for a brand + keyword + content type. */
async function generateSeoContent(brand, keyword, contentType) {
  const systemPrompt = buildSeoContentPrompt(brand, keyword, contentType);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write ${CONTENT_TYPES[contentType] || "blog post"} content optimized for "${keyword}". Respond with only the JSON object.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const content = extractJsonObject(text);
  if (!content || typeof content !== "object") {
    throw new Error("The AI response did not contain SEO content");
  }
  return content;
}

/** Generates ten related keyword ideas with search-volume categories. */
async function generateKeywordSuggestions(topic) {
  const systemPrompt = [
    "You are EchoAI's SEO keyword research agent. Given a topic, you propose realistic, useful keyword ideas a real SEO specialist would target.",
    "",
    "Return EXACTLY 10 keyword ideas as a JSON array (no prose, no markdown fences). Each item must be an object with:",
    '- "keyword": the keyword phrase.',
    '- "volume": one of "high", "medium", or "low" — your best estimate of relative monthly search volume.',
    '- "intent": a one or two word search intent (e.g. "informational", "commercial", "transactional").',
    "",
    "Cover a healthy mix of head terms and long-tail variations.",
  ].join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Suggest 10 keyword ideas for the topic: ${topic}. Respond with only the JSON array.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const raw = extractJsonArray(text);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("The AI response did not contain keyword suggestions");
  }

  // Normalize so the client always gets a valid volume category.
  return raw
    .map((item) => {
      const keyword = typeof item?.keyword === "string" ? item.keyword.trim() : "";
      if (!keyword) return null;
      let volume = String(item?.volume || "").toLowerCase().trim();
      if (!VOLUME_CATEGORIES.includes(volume)) volume = "medium";
      const intent =
        typeof item?.intent === "string" ? item.intent.trim() : "";
      return { keyword, volume, intent };
    })
    .filter(Boolean);
}

module.exports = {
  CONTENT_TYPES,
  VOLUME_CATEGORIES,
  buildSeoContentPrompt,
  generateSeoContent,
  generateKeywordSuggestions,
};
