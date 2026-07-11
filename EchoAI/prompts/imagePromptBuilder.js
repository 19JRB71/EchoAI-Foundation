/**
 * DALL-E prompt builder for Zorecho marketing images.
 *
 * - PURPOSES: the supported image purposes, each mapped to a human label, the
 *   target platform, and the DALL-E size that matches the platform's aspect
 *   ratio (square / landscape / portrait).
 * - VARIANT_STYLES: three distinct visual approaches used to produce an A/B
 *   variation set with consistent branding but different looks.
 * - buildImagePrompt(brand, purpose, description, opts): assembles an optimized,
 *   professional marketing prompt from the brand profile + requirements.
 */

// DALL-E 3 only supports these three sizes.
const SIZE_SQUARE = "1024x1024";
const SIZE_LANDSCAPE = "1792x1024";
const SIZE_PORTRAIT = "1024x1792";

const PURPOSES = {
  facebook_ad: {
    label: "Facebook Ad",
    platform: "facebook",
    size: SIZE_LANDSCAPE,
    aspect: "landscape 16:9",
  },
  instagram_post: {
    label: "Instagram Post",
    platform: "instagram",
    size: SIZE_SQUARE,
    aspect: "square 1:1",
  },
  instagram_story: {
    label: "Instagram Story",
    platform: "instagram",
    size: SIZE_PORTRAIT,
    aspect: "vertical 9:16 full-screen story",
  },
  tiktok_thumbnail: {
    label: "TikTok Thumbnail",
    platform: "tiktok",
    size: SIZE_PORTRAIT,
    aspect: "vertical 9:16",
  },
  twitter_post: {
    label: "Twitter Post",
    platform: "twitter",
    size: SIZE_LANDSCAPE,
    aspect: "landscape 16:9",
  },
  linkedin_post: {
    label: "LinkedIn Post",
    platform: "linkedin",
    size: SIZE_LANDSCAPE,
    aspect: "landscape 16:9",
  },
  blog_header: {
    label: "Blog Header",
    platform: "blog",
    size: SIZE_LANDSCAPE,
    aspect: "wide landscape banner",
  },
  email_header: {
    label: "Email Header",
    platform: "email",
    size: SIZE_LANDSCAPE,
    aspect: "wide landscape banner",
  },
  logo_concept: {
    label: "Logo Concept",
    platform: "brand",
    size: SIZE_SQUARE,
    aspect: "square 1:1 logo concept",
  },
  youtube_thumbnail: {
    label: "YouTube Thumbnail",
    platform: "youtube",
    size: SIZE_LANDSCAPE,
    aspect: "landscape 16:9",
  },
};

const DEFAULT_PURPOSE = "instagram_post";

// Three different creative directions for A/B variation sets. Branding stays
// consistent; only the visual treatment changes.
const VARIANT_STYLES = [
  "Clean and minimal: lots of negative space, a single clear focal subject, restrained composition.",
  "Bold and vibrant: high energy, strong color blocking, dynamic angles, eye-catching contrast.",
  "Premium and editorial: sophisticated lighting, refined textures, a high-end magazine-quality feel.",
];

function isPurpose(value) {
  return Object.prototype.hasOwnProperty.call(PURPOSES, value);
}

function purposeMeta(purpose) {
  return PURPOSES[isPurpose(purpose) ? purpose : DEFAULT_PURPOSE];
}

function sizeFor(purpose) {
  return purposeMeta(purpose).size;
}

/**
 * Flattens a brand's JSONB visual style / audience fields into a short text
 * description for the prompt, tolerating either string or object shapes.
 */
function describeField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  if (typeof value === "object") {
    const parts = [];
    if (value.style) parts.push(`style: ${value.style}`);
    if (value.mood) parts.push(`mood: ${value.mood}`);
    if (value.colors) {
      const colors = Array.isArray(value.colors)
        ? value.colors.join(", ")
        : value.colors;
      parts.push(`colors: ${colors}`);
    }
    if (value.description) parts.push(value.description);
    if (value.summary) parts.push(value.summary);
    if (value.demographics) parts.push(value.demographics);
    return parts.length ? parts.join("; ") : fallback;
  }
  return fallback;
}

/**
 * Builds an optimized DALL-E prompt for a professional marketing image.
 * opts.variantIndex (0-2) selects a creative direction for A/B sets.
 */
function buildImagePrompt(brand, purpose, description, opts = {}) {
  const meta = purposeMeta(purpose);
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and trustworthy";
  const visualStyle = describeField(
    brand.visual_style_preferences,
    "modern, clean, professional"
  );
  const audience = describeField(brand.target_audience, "a general audience");

  const variant =
    typeof opts.variantIndex === "number"
      ? VARIANT_STYLES[opts.variantIndex % VARIANT_STYLES.length]
      : null;

  const lines = [
    `Professional ${meta.label} marketing image for the brand "${name}".`,
    `Subject: ${description}.`,
    `Brand personality: ${personality}.`,
    `Brand visual style: ${visualStyle}.`,
    `Intended audience: ${audience}.`,
    `Composition: ${meta.aspect}, optimized for ${meta.platform}.`,
  ];
  if (variant) lines.push(`Creative direction: ${variant}`);
  lines.push(
    "High-end commercial advertising photography / design, sharp focus, balanced composition, polished lighting, cohesive brand color palette.",
    "Leave clean space suitable for overlaying marketing copy.",
    "Do NOT render any text, words, letters, logos, or watermarks in the image."
  );

  return lines.join(" ");
}

module.exports = {
  PURPOSES,
  DEFAULT_PURPOSE,
  VARIANT_STYLES,
  isPurpose,
  purposeMeta,
  sizeFor,
  buildImagePrompt,
};
