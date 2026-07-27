/**
 * Prompts for the Customer Feedback & Survey System.
 *
 * Two AI agents live here:
 *  1. The Survey Designer — turns a brand voice + interaction context into a
 *     short, on-brand survey.
 *  2. The Feedback Analyst — reads a batch of real customer responses and returns
 *     a plain-language sentiment/theme/recommendation report the owner can act on.
 *
 * Both return STRICT JSON. Validators trim then reject empty/malformed output so
 * no bad data is persisted; callers map any failure to a 502.
 */

const SURVEY_QUESTION_COUNT = 5;

const SURVEY_DESIGNER_SYSTEM_PROMPT = [
  "You are an expert customer-experience researcher who writes short, friendly,",
  "high-signal surveys for small businesses. You match the brand's voice, keep",
  "questions concrete and easy to answer on a phone, and always include exactly",
  "one 1-10 rating question so satisfaction can be measured numerically. You",
  "return STRICT JSON only — no prose, no markdown fences.",
].join(" ");

const FEEDBACK_ANALYST_SYSTEM_PROMPT = [
  "You are a customer-feedback analyst for a small-business owner. You read real",
  "customer survey responses and explain, in plain everyday language (no marketing",
  "jargon), how customers feel, what keeps coming up, what is urgent, what people",
  "love, and exactly what to do next. You are honest and specific. You return",
  "STRICT JSON only — no prose, no markdown fences.",
].join(" ");

const SURVEY_TYPE_CONTEXT = {
  post_purchase: "right after a customer made a purchase",
  post_call: "right after a phone call with the business",
  post_chatbot: "right after a chat conversation on the website",
  general: "as a general check-in about their overall experience",
};

function truncate(value, max = 600) {
  if (!value) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * Builds the prompt that asks the Survey Designer for a 5-question survey.
 */
function buildSurveyGenerationPrompt({ brand, surveyType }) {
  const context = SURVEY_TYPE_CONTEXT[surveyType] || SURVEY_TYPE_CONTEXT.general;
  const lines = [
    `Brand name: ${brand.brand_name || "the business"}`,
    brand.voice_description ? `Brand voice: ${truncate(brand.voice_description)}` : null,
    brand.brand_personality ? `Brand personality: ${truncate(brand.brand_personality)}` : null,
    brand.target_audience ? `Target audience: ${truncate(brand.target_audience)}` : null,
    "",
    `Write a ${SURVEY_QUESTION_COUNT}-question customer satisfaction survey to send ${context}.`,
    "Rules:",
    `- Exactly ${SURVEY_QUESTION_COUNT} questions.`,
    "- Exactly ONE question must be a 1-10 rating of overall satisfaction (type \"rating\").",
    "- The rest are short open-text questions (type \"text\") that surface why they feel that way and how to improve.",
    "- Sound like the brand. Be warm and concise.",
    "",
    "Return STRICT JSON in exactly this shape:",
    "{",
    '  "questions": [',
    '    { "id": "satisfaction", "question": "...", "type": "rating" },',
    '    { "id": "short_slug", "question": "...", "type": "text" }',
    "  ]",
    "}",
    "Each id must be a unique lowercase slug.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/**
 * Builds the prompt that asks the Feedback Analyst to analyze a batch of
 * responses. `responses` is an array of { score, answers } where answers is a
 * map of question text -> answer.
 */
function buildFeedbackAnalysisPrompt({ brand, responses }) {
  const lines = [
    `Brand: ${brand.brand_name || "the business"}`,
    `You are analyzing ${responses.length} real customer survey responses.`,
    "",
    "Responses:",
  ];

  responses.forEach((r, i) => {
    lines.push(`#${i + 1} (satisfaction: ${r.score == null ? "n/a" : `${r.score}/10`})`);
    Object.entries(r.answers || {}).forEach(([q, a]) => {
      if (a && String(a).trim()) lines.push(`  - ${q}: ${truncate(a, 300)}`);
    });
  });

  lines.push(
    "",
    "Analyze these responses and return STRICT JSON in exactly this shape:",
    "{",
    '  "sentimentBreakdown": { "positive": <count>, "neutral": <count>, "negative": <count> },',
    '  "themes": [ { "title": "...", "description": "..." } ],',
    '  "urgentIssues": [ "..." ],',
    '  "customerLoves": [ "..." ],',
    '  "recommendations": [ { "action": "...", "why": "..." } ],',
    '  "reportText": "A few short paragraphs in plain language summarizing how customers feel and what to do."',
    "}",
    "Provide the top 3 themes and exactly 3 actionable recommendations. Sentiment",
    "counts must add up to the number of responses. Plain language only.",
  );

  return lines.join("\n");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function fail(message) {
  const err = new Error(message);
  err.statusCode = 502;
  throw err;
}

/**
 * Validates + normalizes the Survey Designer output. Returns a clean questions
 * array, or throws a 502 if malformed/empty.
 */
function validateSurveyQuestions(parsed) {
  const questions = parsed && Array.isArray(parsed.questions) ? parsed.questions : null;
  if (!isNonEmptyArray(questions)) {
    fail("The AI returned no survey questions");
  }

  const cleaned = questions
    .map((q, i) => {
      if (!q || !isNonEmptyString(q.question)) return null;
      const type = q.type === "rating" ? "rating" : "text";
      const id =
        isNonEmptyString(q.id) ? q.id.trim() : `q${i + 1}`;
      return { id, question: q.question.trim(), type };
    })
    .filter(Boolean);

  if (!isNonEmptyArray(cleaned)) {
    fail("The AI survey questions were all empty");
  }

  // Guarantee a numeric satisfaction signal: if the model didn't mark a rating
  // question, promote the first question to a rating so scores can be captured.
  if (!cleaned.some((q) => q.type === "rating")) {
    cleaned[0].type = "rating";
  }

  return cleaned;
}

/**
 * Validates + normalizes the Feedback Analyst output. Returns a clean report
 * object, or throws a 502 if malformed/empty.
 */
function validateFeedbackReport(parsed) {
  if (!parsed || typeof parsed !== "object") {
    fail("The AI returned no feedback analysis");
  }

  const themes = Array.isArray(parsed.themes)
    ? parsed.themes
        .filter((t) => t && isNonEmptyString(t.title))
        .map((t) => ({ title: t.title.trim(), description: String(t.description || "").trim() }))
    : [];
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r) => r && isNonEmptyString(r.action))
        .map((r) => ({ action: r.action.trim(), why: String(r.why || "").trim() }))
    : [];

  if (!isNonEmptyArray(themes)) fail("The AI feedback analysis had no themes");
  if (!isNonEmptyArray(recommendations)) {
    fail("The AI feedback analysis had no recommendations");
  }
  if (!isNonEmptyString(parsed.reportText)) {
    fail("The AI feedback analysis had no report text");
  }

  const sb = parsed.sentimentBreakdown || {};
  const sentimentBreakdown = {
    positive: Number(sb.positive) || 0,
    neutral: Number(sb.neutral) || 0,
    negative: Number(sb.negative) || 0,
  };

  return {
    sentimentBreakdown,
    themes,
    urgentIssues: Array.isArray(parsed.urgentIssues)
      ? parsed.urgentIssues.filter(isNonEmptyString).map((s) => s.trim())
      : [],
    customerLoves: Array.isArray(parsed.customerLoves)
      ? parsed.customerLoves.filter(isNonEmptyString).map((s) => s.trim())
      : [],
    recommendations,
    reportText: parsed.reportText.trim(),
  };
}

module.exports = {
  SURVEY_QUESTION_COUNT,
  SURVEY_DESIGNER_SYSTEM_PROMPT,
  FEEDBACK_ANALYST_SYSTEM_PROMPT,
  buildSurveyGenerationPrompt,
  buildFeedbackAnalysisPrompt,
  validateSurveyQuestions,
  validateFeedbackReport,
};
