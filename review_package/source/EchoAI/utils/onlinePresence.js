/**
 * Online-presence normalizers: the business's own website URL and Facebook
 * page. Shared by the brand update endpoint (manual owner edits) and the
 * Setup Agent (interview answers), so both paths store the same shape.
 *
 * Contract: each normalizer returns
 *   { ok: true, value: <string|null> }  — value null means "cleared"
 *   { ok: false }                       — input was provided but unusable
 * Empty/blank input is a deliberate clear (ok:true, value:null); callers that
 * must NOT clear (AI capture / non-empty merge) skip null values themselves.
 */

function normalizeWebsiteUrl(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  // A real site needs a dot in the hostname (rejects "localhost", bare words).
  if (!url.hostname.includes(".")) return { ok: false };
  return { ok: true, value: url.href };
}

// Accepts a full facebook.com/fb.com URL or a bare page handle ("myshop",
// "@myshop") and normalizes to a canonical https://www.facebook.com/<path>.
function normalizeFacebookPageUrl(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const raw = input.trim().replace(/^@/, "");
  if (!raw) return { ok: true, value: null };

  if (/^(https?:\/\/)?(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i.test(raw)) {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url;
    try {
      url = new URL(candidate);
    } catch {
      return { ok: false };
    }
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return { ok: false };
    return { ok: true, value: `https://www.facebook.com${path}${url.search}` };
  }

  // Not a facebook URL. If it looks like some other URL/domain, reject —
  // don't silently turn "mysite.com" into a facebook page.
  if (/[/.]/.test(raw)) return { ok: false };
  if (!/^[A-Za-z0-9.\-_]+$/.test(raw)) return { ok: false };
  return { ok: true, value: `https://www.facebook.com/${raw}` };
}

// --- Sage V2 P4: other social/profile URLs (instagram, linkedin, youtube,
// tiktok, google business). Accepts a full URL on an allowed host, or (where
// handles make sense) a bare "@handle"; normalizes to a canonical https URL.
const SOCIAL_PLATFORMS = {
  instagram: { hosts: ["instagram.com"], canonical: "https://www.instagram.com/", handle: true },
  linkedin: { hosts: ["linkedin.com"], canonical: null, handle: false },
  youtube: { hosts: ["youtube.com", "youtu.be"], canonical: "https://www.youtube.com/", handle: true },
  tiktok: { hosts: ["tiktok.com"], canonical: "https://www.tiktok.com/@", handle: true },
  google_business: { hosts: ["google.com", "g.page", "maps.app.goo.gl", "goo.gl", "business.google.com"], canonical: null, handle: false },
};

function normalizeSocialUrl(platform, input) {
  const spec = SOCIAL_PLATFORMS[platform];
  if (!spec) return { ok: false };
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };

  // Bare handle ("@myshop" / "myshop") for platforms where that is unambiguous.
  if (spec.handle && !/[/.]/.test(raw.replace(/^@/, ""))) {
    const handle = raw.replace(/^@/, "");
    if (!/^[A-Za-z0-9._\-]+$/.test(handle)) return { ok: false };
    if (!spec.canonical) return { ok: false }; // no unambiguous handle form
    return { ok: true, value: `${spec.canonical}${handle}` };
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const allowed = spec.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) return { ok: false };
  return { ok: true, value: `https://${url.hostname}${url.pathname.replace(/\/+$/, "")}${url.search}` };
}

// True when an interview answer is a refusal ("no", "we don't have one") —
// word-bounded so real inputs like "northsideplumbing.com" are never treated
// as a "no". Used by AI-capture paths, which must skip (never store) refusals.
function isRefusalAnswer(input) {
  if (typeof input !== "string") return false;
  return /^\s*(?:no|none|nope|nah|n\/a|not yet|nothing|we don'?t|i don'?t|don'?t have)\b/i.test(
    input,
  );
}

module.exports = {
  normalizeWebsiteUrl,
  normalizeFacebookPageUrl,
  normalizeSocialUrl,
  SOCIAL_PLATFORMS,
  isRefusalAnswer,
};
