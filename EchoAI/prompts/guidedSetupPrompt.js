/**
 * Guided Setup "Help Me" screenshot analyst.
 *
 * When a new customer gets stuck mid-setup (usually inside a Facebook or
 * Google OAuth screen), they can upload a screenshot of what they're seeing.
 * This agent looks at the image (vision) and answers, in plain words a
 * non-technical small business owner understands:
 *   - what screen they are looking at, and
 *   - exactly what to click or do next.
 *
 * Honesty rules (platform-wide conventions):
 *   - Empty/malformed AI output throws an `aiInvalid` error so the controller
 *     maps it to 502 — guidance is NEVER fabricated or mocked.
 *   - The model must self-report confidence; anything unclear comes back as
 *     "low" and the client shows an honest "I'm not sure — let's get you
 *     help" with support escalation instead of a guess.
 */

const { createMessage, MODEL } = require("../config/anthropic");

const CONFIDENCE_LEVELS = ["high", "medium", "low"];

function buildSetupHelpSystemPrompt() {
  return [
    "You are Echo — EchoAI's warm, patient setup guide. A brand-new customer is going through account setup (connecting Facebook, connecting Google, or answering setup questions) and got stuck. They uploaded a screenshot of what they see right now.",
    "Your job: recognize the screen and tell them the ONE next thing to do, in plain everyday words. They are a busy small business owner, not a technical person.",
    "",
    "Screens you may see include: a Facebook or Google login page, a Facebook permission/consent dialog, a Facebook Page-selection screen, a Google account chooser, a Google consent screen, a browser popup-blocked notice, a browser password prompt, an error page from Facebook or Google, or one of EchoAI's own setup screens.",
    "",
    "Respond ONLY with a single JSON object (no markdown, no prose outside the JSON) of the exact shape:",
    "{",
    '  "screen": string,      // one short sentence naming the screen in plain words, e.g. "You\'re on Facebook\'s login page."',
    '  "nextAction": string,  // exactly what to click or type next, in one or two short plain sentences, e.g. "Type the email and password you use for Facebook, then press the blue Log In button."',
    '  "confidence": "high" | "medium" | "low"',
    "}",
    "",
    "Rules:",
    "- Only describe what is actually visible in the screenshot. Never invent buttons, screens, or steps you cannot see.",
    "- Name buttons by their visible label and color when possible ('the blue Continue button').",
    "- No technical jargon: never say OAuth, API, token, authenticate, credentials, or URL. Say 'sign in', 'give permission', 'the address bar' instead.",
    "- If the screenshot is blurry, cropped, unreadable, or shows a screen you cannot confidently identify, set confidence to \"low\" and say honestly in nextAction that you are not sure. Never guess.",
    "- If the screen shows an error message, quote the important part in plain words and say what usually fixes it.",
    "- Keep it reassuring: this customer may be frustrated. One clear step, not a list of possibilities.",
  ].join("\n");
}

/**
 * Validates a parsed AI response into the exact shape the client relies on.
 * Missing screen/nextAction → aiInvalid (mapped to 502 upstream). An invalid
 * confidence value is honestly downgraded to "low" (never upgraded).
 * Exported for tests.
 */
function validateSetupHelpAnalysis(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const err = new Error("The AI setup-help response was not an object");
    err.aiInvalid = true;
    throw err;
  }
  const screen = typeof parsed.screen === "string" ? parsed.screen.trim() : "";
  const nextAction =
    typeof parsed.nextAction === "string" ? parsed.nextAction.trim() : "";
  if (!screen || !nextAction) {
    const err = new Error("The AI setup-help response was missing guidance");
    err.aiInvalid = true;
    throw err;
  }
  const confidence = CONFIDENCE_LEVELS.includes(parsed.confidence)
    ? parsed.confidence
    : "low";
  return { screen, nextAction, confidence };
}

/**
 * Analyzes a stuck customer's setup screenshot. `context` is an optional short
 * plain-text hint from the client about where they were (e.g. "connecting
 * Facebook"). Throws aiInvalid on any unusable AI output.
 */
async function analyzeSetupHelpScreenshot({ imageBase64, mediaType, context }) {
  const content = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType || "image/png",
        data: imageBase64,
      },
    },
    {
      type: "text",
      text:
        `The customer was in the middle of: ${(context || "").trim() || "account setup"}.\n` +
        "Look at their screenshot and respond with the JSON object described.",
    },
  ];

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 500,
      system: buildSetupHelpSystemPrompt(),
      messages: [{ role: "user", content }],
    },
    { label: "Guided setup help" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI setup-help response was empty");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const err = new Error("The AI setup-help response was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  return validateSetupHelpAnalysis(parsed);
}

module.exports = {
  buildSetupHelpSystemPrompt,
  validateSetupHelpAnalysis,
  analyzeSetupHelpScreenshot,
  CONFIDENCE_LEVELS,
};
