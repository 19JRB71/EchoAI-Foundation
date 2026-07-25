/**
 * AI Review Response Agent.
 *
 * generateReviewResponse(brand, review) calls Anthropic to write a professional,
 * personalized reply to a customer review that matches the brand's voice and
 * personality. The tone is tailored to the star rating:
 *   - 5 stars: genuine gratitude, reinforce what the customer loved.
 *   - 3-4 stars: thank them, acknowledge feedback, explain how things improve.
 *   - 1-2 stars: calm and professional, acknowledge the concern, apologize
 *     sincerely, and offer to make it right with contact information.
 * It must never sound defensive or automated — it should read as if the business
 * owner wrote it personally.
 */

const { anthropic, MODEL } = require("../config/anthropic");

function ratingGuidance(rating) {
  const r = Number(rating) || 0;
  if (r >= 5) {
    return [
      "This is a 5-star review. Express genuine, specific gratitude.",
      "Reinforce exactly what the customer said they loved (reference details from their review).",
      "Warmly invite them back. Keep it joyful but not over-the-top.",
    ];
  }
  if (r >= 3) {
    return [
      `This is a ${r}-star review — positive but with room to improve.`,
      "Thank them sincerely for the feedback.",
      "Acknowledge the specific concern or suggestion they raised.",
      "Briefly explain how the business is improving or what you'll do about it — be genuine, not generic.",
    ];
  }
  return [
    `This is a ${r}-star review — the customer had a poor experience.`,
    "Respond calmly and professionally. Never be defensive, never make excuses.",
    "Acknowledge their specific concern and apologize sincerely.",
    "Offer to make it right and invite them to reach out directly so you can resolve it.",
    "Include the provided contact information so they can follow up offline.",
  ];
}

function buildReviewResponsePrompt(brand, review) {
  const name = brand.brand_name || "our business";
  const personality = brand.brand_personality || "professional and friendly";
  const voice = brand.voice_description || "warm, clear, and human";
  const reviewer = review.reviewerName || review.reviewer_name || "the customer";
  const rating = Number(review.starRating ?? review.star_rating) || 0;
  const platform = review.platform || "the review site";
  const text = review.reviewText || review.review_text || "";
  const contact = review.contactInfo || brand.contact_info || null;

  const lines = [
    `You are the owner of "${name}", personally replying to a customer review left on ${platform}.`,
    `Brand personality: ${personality}.`,
    `Brand voice: ${voice}.`,
    "Write the reply in that exact voice — it must feel hand-written by the owner, never automated or templated.",
    "",
    `Reviewer: ${reviewer}`,
    `Star rating: ${rating} out of 5`,
    `Review text: "${text}"`,
    "",
    "How to handle this review:",
    ...ratingGuidance(rating).map((g) => `- ${g}`),
  ];

  if (contact) {
    lines.push(`- Contact information to include if appropriate: ${contact}`);
  } else if (rating <= 2) {
    lines.push(
      "- No specific contact info was provided; invite them to reach out via the business's usual contact channel.",
    );
  }

  lines.push(
    "",
    "Rules:",
    "- Address the reviewer by name when natural.",
    "- Keep it concise (2-5 sentences) and genuine.",
    "- No markdown, no signatures like '[Your Name]', no placeholders. Write a ready-to-post reply.",
    "- Output ONLY the reply text, nothing else.",
  );

  return lines.join("\n");
}

async function generateReviewResponse(brand, review) {
  const systemPrompt = buildReviewResponsePrompt(brand, review);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content:
          "Write the personalized reply to this review now. Output only the reply.",
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    throw new Error("The AI response did not contain a reply");
  }
  return text.trim();
}

module.exports = { buildReviewResponsePrompt, generateReviewResponse };
