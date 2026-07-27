/**
 * AI agents for Zorecho's Email Marketing subsystem.
 *
 * Two agents:
 *   - Email Campaign Writer (`generateCampaignEmail`): writes ONE on-brand
 *     marketing email — three split-test subject lines, a preview text, and the
 *     full body in both HTML and plain text — for a one-time campaign.
 *   - Drip Sequence Designer (`generateDripSequence`): designs a multi-email
 *     nurture sequence; each step carries its own send delay (in days), subject,
 *     preview text, and HTML + plain-text body.
 *
 * Both call Anthropic for real. Output is validated before returning: empty or
 * malformed responses throw with `err.aiInvalid = true` so the controller maps
 * them to 502 (never a mock, never placeholder copy). The SDK itself throws on
 * upstream billing/rate failures, which the controller also maps to 502.
 */

const { anthropic, MODEL, createMessage, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");

const NUM_SUBJECTS = 3;
const MIN_DRIP_EMAILS = 3;
const MAX_DRIP_EMAILS = 7;

function describeField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  if (typeof value === "object") {
    const parts = [];
    if (value.description) parts.push(value.description);
    if (value.demographics) parts.push(value.demographics);
    if (Array.isArray(value.interests) && value.interests.length) {
      parts.push(`interests: ${value.interests.join(", ")}`);
    }
    return parts.length ? parts.join("; ") : fallback;
  }
  return fallback;
}

function brandSummary(brand) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and trustworthy";
  const voice = brand.voice_description || "clear, confident, benefit-focused";
  const audience = describeField(brand.target_audience, "a general audience");
  return [
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
  ].join("\n");
}

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

function extractJson(text, open, close) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf(open);
  const end = candidate.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the AI email response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeEmail(raw) {
  if (!raw || typeof raw !== "object") return null;
  const subjectVariations = Array.isArray(raw.subjectVariations)
    ? raw.subjectVariations.map(cleanStr).filter(Boolean)
    : [];
  const bodyHtml = cleanStr(raw.bodyHtml);
  const bodyPlainText = cleanStr(raw.bodyPlainText);
  if (!subjectVariations.length || !bodyHtml || !bodyPlainText) return null;
  return {
    subjectVariations: subjectVariations.slice(0, NUM_SUBJECTS),
    previewText: cleanStr(raw.previewText),
    bodyHtml,
    bodyPlainText,
  };
}

/**
 * Email Campaign Writer — one on-brand marketing email for a one-time campaign.
 * Returns { subjectVariations:[3], previewText, bodyHtml, bodyPlainText }.
 * Throws (err.aiInvalid) on malformed output.
 */
async function generateCampaignEmail(brand, { goal, audienceSegment, topic }) {
  const system = [
    "You are Zorecho's Email Campaign Writer — an expert direct-response email copywriter.",
    "Write ONE complete, on-brand marketing email.",
    "",
    "Brand profile:",
    brandSummary(brand),
    "",
    `Campaign goal: ${goal}`,
    audienceSegment ? `Audience segment: ${audienceSegment}` : "",
    topic ? `Topic / offer: ${topic}` : "",
    "",
    "Requirements:",
    `- Write EXACTLY ${NUM_SUBJECTS} distinct subject lines to split-test (compelling, under ~60 chars, no spammy ALL CAPS or excessive punctuation).`,
    "- Write one preview text line (under ~90 chars) that complements the subject.",
    "- Write the body with a strong hook, clear value, and a single primary call to action, all in the brand's voice.",
    "- Provide the body as clean, email-safe HTML (inline-friendly, no <script>, no external CSS) AND as a plain-text version.",
    "- Do NOT include an unsubscribe link or tracking pixel — the system appends those automatically.",
    "",
    "Return ONLY a JSON object (no prose, no markdown fences) with keys:",
    '"subjectVariations" (array of 3 strings), "previewText" (string), "bodyHtml" (string), "bodyPlainText" (string).',
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [
      {
        role: "user",
        content: `Write the campaign email for goal: ${goal}. Respond with only the JSON object.`,
      },
    ],
  });

  const text = extractText(response);
  let email;
  try {
    email = normalizeEmail(extractJson(text, "{", "}"));
  } catch (err) {
    err.aiInvalid = true;
    throw err;
  }
  if (!email) {
    const err = new Error("The AI returned an incomplete campaign email");
    err.aiInvalid = true;
    throw err;
  }
  return email;
}

function normalizeDripEmail(raw, index) {
  const base = normalizeEmail(raw);
  if (!base) return null;
  let delay = Number(raw.sendDelayDays);
  if (!Number.isFinite(delay) || delay < 0) delay = index === 0 ? 0 : index;
  return { ...base, sendDelayDays: Math.round(delay) };
}

/**
 * Drip Sequence Designer — a multi-email nurture sequence.
 * Returns [{ subjectVariations, previewText, bodyHtml, bodyPlainText, sendDelayDays }].
 * Throws (err.aiInvalid) on malformed output.
 */
async function generateDripSequence(brand, { goal, audienceSegment, numEmails }) {
  let count = Number(numEmails);
  if (!Number.isFinite(count)) count = 5;
  count = Math.min(MAX_DRIP_EMAILS, Math.max(MIN_DRIP_EMAILS, Math.round(count)));

  const system = [
    "You are Zorecho's Drip Sequence Designer — an expert at automated email nurture sequences.",
    `Design a cohesive ${count}-email drip sequence that moves the reader toward the goal step by step.`,
    "",
    "Brand profile:",
    brandSummary(brand),
    "",
    `Sequence goal: ${goal}`,
    audienceSegment ? `Audience segment: ${audienceSegment}` : "",
    "",
    "Requirements:",
    "- Each email builds on the previous one (welcome/intro → value/education → social proof → offer → urgency, etc.).",
    "- Give each email its own send delay in DAYS from enrollment. The first email is usually day 0; later emails are spaced sensibly (e.g. 0, 2, 4, 7, 10).",
    `- For EACH email provide ${NUM_SUBJECTS} subject-line variations, a preview text (<90 chars), an HTML body, and a plain-text body, all in the brand voice.`,
    "- Email-safe HTML only (no <script>, no external CSS). Do NOT include unsubscribe links or tracking pixels — the system appends those.",
    "",
    `Return ONLY a JSON array of EXACTLY ${count} objects (no prose, no markdown fences), each with keys:`,
    '"sendDelayDays" (number), "subjectVariations" (array of 3 strings), "previewText" (string), "bodyHtml" (string), "bodyPlainText" (string).',
  ]
    .filter(Boolean)
    .join("\n");

  // Drip generation is AI-heavy (a full multi-email JSON sequence), so it gets a
  // longer per-request timeout and automatic retry on transient upstream
  // failures before the error ever reaches the user.
  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: "user",
          content: `Design the ${count}-email drip sequence for goal: ${goal}. Respond with only the JSON array.`,
        },
      ],
    },
    { timeout: HEAVY_AI_TIMEOUT_MS, label: "Drip Sequence Designer" },
  );

  const text = extractText(response);
  let emails;
  try {
    const raw = extractJson(text, "[", "]");
    if (!Array.isArray(raw)) {
      throw new Error("The AI response was not a JSON array of emails");
    }
    emails = raw.map(normalizeDripEmail).filter(Boolean);
  } catch (err) {
    err.aiInvalid = true;
    throw err;
  }
  if (emails.length < MIN_DRIP_EMAILS) {
    const err = new Error(
      `The AI returned only ${emails.length} valid drip emails (need at least ${MIN_DRIP_EMAILS})`
    );
    err.aiInvalid = true;
    throw err;
  }
  return emails;
}

module.exports = {
  NUM_SUBJECTS,
  MIN_DRIP_EMAILS,
  MAX_DRIP_EMAILS,
  generateCampaignEmail,
  generateDripSequence,
};
