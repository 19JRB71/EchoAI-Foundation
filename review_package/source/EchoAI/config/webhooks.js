/**
 * SSRF guardrails for outbound webhook URLs.
 *
 * A webhook URL is supplied by an authenticated user and is later used as an
 * outbound HTTP POST target by the webhook dispatcher. Without a guardrail this
 * is a server-side request forgery vector — a user could point a webhook at
 * internal services (localhost, the metadata endpoint 169.254.169.254, private
 * RFC1918 ranges, etc.). This mirrors the allowlist approach used for saved
 * image URLs and web-push endpoints, but because webhook targets are genuinely
 * arbitrary third-party hosts (Zapier, Make, Slack, …) we cannot use a fixed
 * host allowlist — instead we require https and reject any URL that targets or
 * resolves to a private/reserved address.
 */

const dns = require("dns").promises;
const net = require("net");

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  return false;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // not a recognizable IP → treat as unsafe
}

function isBlockedHostname(host) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

function parseWebhookUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { ok: false, error: "Invalid webhook URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Webhook URL must use https" };
  }
  return { ok: true, url };
}

/**
 * Fast structural check (no DNS) for create-time validation / UI feedback:
 * requires https, a non-internal hostname, and — when the host is an IP literal
 * — a public address.
 */
function isAllowedWebhookUrl(raw) {
  const parsed = parseWebhookUrl(raw);
  if (!parsed.ok) return false;
  const host = parsed.url.hostname.toLowerCase();
  if (!host || isBlockedHostname(host)) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  return true;
}

/**
 * Dispatch-time check that additionally resolves the hostname and rejects it if
 * ANY resolved address is private/reserved — defending against names that point
 * at internal infrastructure. Returns the parsed URL on success; throws on any
 * violation. (Note: this does not fully prevent DNS rebinding between resolve
 * and connect, but blocks the common SSRF cases.)
 */
async function assertSafeWebhookTarget(raw) {
  const parsed = parseWebhookUrl(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const host = parsed.url.hostname.toLowerCase();
  if (!host || isBlockedHostname(host)) {
    throw new Error("Webhook URL host is not allowed");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Webhook URL targets a private address");
    return parsed.url;
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("Webhook URL host could not be resolved");
  }
  if (!addrs.length) throw new Error("Webhook URL host could not be resolved");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("Webhook URL resolves to a private address");
    }
  }
  return parsed.url;
}

module.exports = { isAllowedWebhookUrl, assertSafeWebhookTarget, isPrivateIp };
