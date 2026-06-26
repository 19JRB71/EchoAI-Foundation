// Shared metadata for the supported social platforms: brand color (used for the
// calendar dots and badges), display label, monogram, and the credential fields
// each platform needs to connect (matches the backend's verify/publish flow).

export const PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "twitter",
  "youtube",
];

export const PLATFORM_META = {
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    monogram: "f",
    fields: [
      { key: "accessToken", label: "Access token", required: true },
      { key: "pageId", label: "Page ID", required: true },
    ],
  },
  instagram: {
    label: "Instagram",
    color: "#E1306C",
    monogram: "Ig",
    fields: [
      { key: "accessToken", label: "Access token", required: true },
      { key: "igUserId", label: "IG user ID", required: true },
    ],
  },
  tiktok: {
    label: "TikTok",
    color: "#111827",
    monogram: "Tk",
    fields: [{ key: "accessToken", label: "Access token", required: true }],
  },
  linkedin: {
    label: "LinkedIn",
    color: "#0A66C2",
    monogram: "in",
    fields: [
      { key: "accessToken", label: "Access token", required: true },
      { key: "authorUrn", label: "Author URN", required: true },
    ],
  },
  twitter: {
    label: "Twitter",
    color: "#1DA1F2",
    monogram: "X",
    fields: [{ key: "accessToken", label: "Access token", required: true }],
  },
  youtube: {
    label: "YouTube",
    color: "#FF0000",
    monogram: "Yt",
    fields: [{ key: "accessToken", label: "Access token", required: true }],
  },
};

export function platformMeta(platform) {
  return (
    PLATFORM_META[platform] || {
      label: platform || "Unknown",
      color: "#6B7280",
      monogram: "?",
      fields: [{ key: "accessToken", label: "Access token", required: true }],
    }
  );
}

// A small brand-colored monogram used as the "platform icon" throughout the
// social media section.
export function PlatformBadge({ platform, size = 28, className = "" }) {
  const meta = platformMeta(platform);
  return (
    <span
      title={meta.label}
      style={{ backgroundColor: meta.color, width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white ${className}`}
    >
      {meta.monogram}
    </span>
  );
}

// A tiny solid dot in the platform's brand color (used in calendar day cells).
export function PlatformDot({ platform, size = 8 }) {
  const meta = platformMeta(platform);
  return (
    <span
      title={meta.label}
      style={{ backgroundColor: meta.color, width: size, height: size }}
      className="inline-block rounded-full"
    />
  );
}
