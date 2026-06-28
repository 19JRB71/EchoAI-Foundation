// Default EchoAI branding. Mirrors config/whiteLabel.js on the server so the
// client always has a complete theme even before (or without) an agency match.
export const DEFAULT_BRANDING = {
  agencyName: "EchoAI",
  logoUrl: null,
  primaryColor: "#f59e0b", // amber-500
  secondaryColor: "#111827", // gray-900
  supportEmail: null,
};

// Maps the server's snake_case branding payload to the camelCase shape the
// client uses, filling any gaps with the defaults.
export function normalizeBranding(raw) {
  if (!raw) return { ...DEFAULT_BRANDING };
  return {
    agencyName: raw.agencyName || raw.agency_name || DEFAULT_BRANDING.agencyName,
    logoUrl: raw.logoUrl ?? raw.logo_url ?? DEFAULT_BRANDING.logoUrl,
    primaryColor:
      raw.primaryColor || raw.primary_color || DEFAULT_BRANDING.primaryColor,
    secondaryColor:
      raw.secondaryColor || raw.secondary_color || DEFAULT_BRANDING.secondaryColor,
    supportEmail: raw.supportEmail ?? raw.support_email ?? DEFAULT_BRANDING.supportEmail,
  };
}

// Returns whether a branding object is the unmodified EchoAI default (used to
// keep the stylized "Echo[AI]" wordmark only for the first-party brand).
export function isDefaultBrand(branding) {
  return !branding || branding.agencyName === DEFAULT_BRANDING.agencyName;
}

// Applies the branding to the document: CSS variables for the accent colors and
// the page title. Components can use var(--brand-primary) / inline styles.
export function applyBrandingToDocument(branding) {
  const b = branding || DEFAULT_BRANDING;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", b.primaryColor);
  root.style.setProperty("--brand-secondary", b.secondaryColor);
  if (b.agencyName) document.title = b.agencyName;
}
