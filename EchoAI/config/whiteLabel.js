/**
 * White-label agency configuration helpers (single source of truth for the
 * default Zorecho branding and the validators used when an agency owner saves
 * their custom branding).
 *
 * The defaults are returned to the client whenever a request's domain does not
 * resolve to an active agency, so the dashboard always has a complete theme to
 * apply (it never has to hard-code colors itself).
 */

// Zorecho's own branding — amber accent on a near-black shell. Mirrors the
// hard-coded Tailwind values the client used before white-labeling existed.
const DEFAULT_BRANDING = {
  agencyName: "Zorecho",
  logoUrl: null,
  primaryColor: "#f59e0b", // amber-500
  secondaryColor: "#111827", // gray-900
  supportEmail: null,
};

// #abc or #aabbcc hex colors only — these are injected into the page as CSS
// variables / inline styles, so we keep them to a strict, safe shape.
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// A bare hostname (optionally with subdomains): "agency.com", "app.agency.io".
// No scheme, port, path, or whitespace.
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isHexColor(value) {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim());
}

function normalizeDomain(value) {
  if (typeof value !== "string") return "";
  // Strip an accidental scheme / path / port and l-case so lookups by Host
  // header (also l-cased) match what was stored.
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/:].*$/, "");
}

function isValidDomain(value) {
  return DOMAIN_RE.test(normalizeDomain(value));
}

function isValidEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

// Logos are rendered as an <img src> in the browser (never fetched server-side),
// but we still require a well-formed http(s) URL so a bad value can't inject
// anything unexpected into the markup.
function isValidLogoUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_BRANDING,
  isHexColor,
  isValidDomain,
  normalizeDomain,
  isValidEmail,
  isValidLogoUrl,
};
