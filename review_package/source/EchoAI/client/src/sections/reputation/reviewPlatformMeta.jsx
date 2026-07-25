// Platform metadata for the review sources (Google, Facebook, Yelp): brand color,
// label, and a monogram used as the "platform icon" in the review inbox.

export const REVIEW_PLATFORMS = ["google", "facebook", "yelp"];

export const REVIEW_PLATFORM_META = {
  google: { label: "Google", color: "#4285F4", monogram: "G" },
  facebook: { label: "Facebook", color: "#1877F2", monogram: "f" },
  yelp: { label: "Yelp", color: "#FF1A1A", monogram: "Y" },
};

export function reviewPlatformMeta(platform) {
  return (
    REVIEW_PLATFORM_META[platform] || {
      label: platform || "Unknown",
      color: "#6B7280",
      monogram: "?",
    }
  );
}

export function ReviewPlatformBadge({ platform, size = 28, className = "" }) {
  const meta = reviewPlatformMeta(platform);
  return (
    <span
      title={meta.label}
      style={{ backgroundColor: meta.color, width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-xs font-bold leading-none text-white ${className}`}
    >
      {meta.monogram}
    </span>
  );
}
