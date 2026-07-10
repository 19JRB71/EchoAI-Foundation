/**
 * Owner-supplied competitor website URL validation + normalization.
 *
 * Scout reads competitor sites via Anthropic's server-side web_fetch tool (the
 * fetch runs on Anthropic's infra, not ours, so there is no direct SSRF against
 * our network), but we still validate + normalize what the owner types before
 * storing or handing it to the model:
 *   - require an http/https URL (http is upgraded to https)
 *   - reject private / internal / loopback / link-local hosts and bare hostnames
 *   - normalize (lowercase host, drop default port + fragment, strip trailing "/")
 * so the per-(brand, url) uniqueness key dedups reliably.
 *
 * Throws an Error with `.badUrl = true` (and a plain-English message) on any
 * invalid or non-public URL so the controller can return a 400.
 */

const net = require("net");

function badUrl(message) {
  const err = new Error(message);
  err.badUrl = true;
  return err;
}

/** IPv4 literal in a private / reserved / loopback / link-local range. */
function isPrivateIpv4(host) {
  if (net.isIPv4(host) !== true) return false;
  const p = host.split(".").map(Number);
  if (p[0] === 10) return true; // 10.0.0.0/8
  if (p[0] === 127) return true; // loopback
  if (p[0] === 0) return true; // 0.0.0.0/8
  if (p[0] === 169 && p[1] === 254) return true; // link-local
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
  if (p[0] === 192 && p[1] === 168) return true; // 192.168/16
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
  return false;
}

/**
 * If an IPv6 literal embeds an IPv4 address (IPv4-mapped `::ffff:x` or the
 * deprecated IPv4-compatible `::x` form), return the dotted-quad string so we can
 * range-check it as IPv4. Handles both the dotted tail (`::ffff:127.0.0.1`) and
 * the hex tail (`::ffff:7f00:1`). Returns null when there is no embedded IPv4.
 */
function embeddedIpv4(h) {
  const s = h.toLowerCase();
  let m = s.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m && net.isIPv4(m[1])) return m[1];
  m = s.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    const ip = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    if (net.isIPv4(ip)) return ip;
  }
  return null;
}

/** IPv6 literal that is loopback / link-local / unique-local / unspecified. */
function isPrivateIpv6(host) {
  if (net.isIPv6(host) !== true) return false;
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped / -compatible forms (e.g. ::ffff:127.0.0.1, ::ffff:7f00:1) would
  // otherwise slip past the prefix checks above — range-check the embedded IPv4.
  const mapped = embeddedIpv4(h);
  if (mapped && isPrivateIpv4(mapped)) return true;
  return false;
}

/** True when a host must NOT be monitored (internal / non-public). */
function isBlockedHost(host) {
  if (!host) return true;
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost") return true;
  if (
    h.endsWith(".local") ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan")
  ) {
    return true;
  }
  if (isPrivateIpv4(h) || isPrivateIpv6(h)) return true;
  // Require a fully-qualified public hostname: at least one dot and a TLD, unless
  // it is a (public) IP literal.
  const isIp = net.isIP(h) !== 0;
  if (!isIp && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) return true;
  return false;
}

/**
 * Validate + normalize an owner-entered competitor website URL.
 * Returns the normalized URL string; throws (err.badUrl) when invalid/non-public.
 */
function normalizeCompetitorUrl(raw) {
  let input = String(raw || "").trim();
  if (!input) throw badUrl("Please enter a competitor website URL.");
  if (input.length > 2000) throw badUrl("That URL is too long.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let u;
  try {
    u = new URL(input);
  } catch (_e) {
    throw badUrl("That doesn't look like a valid website URL.");
  }

  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") {
    throw badUrl("Only http(s) website URLs can be monitored.");
  }

  const host = u.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    throw badUrl(
      "That URL points to a private or internal address. Enter a public competitor website.",
    );
  }

  // Normalize for stable dedup: lowercase host, no default port, no fragment,
  // strip a trailing slash on the path.
  u.hostname = host;
  u.hash = "";
  if (u.port === "443") u.port = "";
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

module.exports = { normalizeCompetitorUrl, isBlockedHost };
