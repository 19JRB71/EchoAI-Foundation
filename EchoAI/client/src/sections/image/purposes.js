// Mirrors the backend PURPOSES map (prompts/imagePromptBuilder.js): label +
// platform per image purpose. Drives the Image Studio purpose dropdown.
export const PURPOSES = [
  { key: "facebook_ad", label: "Facebook Ad", platform: "facebook" },
  { key: "instagram_post", label: "Instagram Post", platform: "instagram" },
  { key: "instagram_story", label: "Instagram Story", platform: "instagram" },
  { key: "tiktok_thumbnail", label: "TikTok Thumbnail", platform: "tiktok" },
  { key: "linkedin_post", label: "LinkedIn Post", platform: "linkedin" },
  { key: "twitter_post", label: "Twitter Post", platform: "twitter" },
  { key: "blog_header", label: "Blog Header", platform: "blog" },
  { key: "email_header", label: "Email Header", platform: "email" },
  { key: "logo_concept", label: "Logo Concept", platform: "brand" },
];

export function purposeLabel(key) {
  const p = PURPOSES.find((x) => x.key === key);
  return p ? p.label : key;
}
