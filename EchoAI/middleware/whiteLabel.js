const db = require("../config/db");
const { normalizeDomain } = require("../config/whiteLabel");

/**
 * White-label middleware. Looks at the incoming request's host (the custom
 * domain or subdomain the dashboard is being served on) and, if it matches an
 * active agency, attaches that agency's branding to `req.agencyBranding` so the
 * frontend can theme itself dynamically.
 *
 * Resolution order for the host:
 *   1. An explicit `X-White-Label-Domain` header (lets a proxy/embed force a
 *      specific agency, and makes local testing possible without real DNS).
 *   2. `X-Forwarded-Host` (set by the Replit reverse proxy / load balancers).
 *   3. The standard `Host` header.
 *
 * This is best-effort and MUST never block or fail a request: any error (or no
 * match) simply leaves `req.agencyBranding` undefined and the client falls back
 * to the default Zorecho branding.
 */
async function whiteLabel(req, res, next) {
  try {
    const rawHost =
      req.headers["x-white-label-domain"] ||
      req.headers["x-forwarded-host"] ||
      req.headers.host ||
      "";
    // X-Forwarded-Host can be a comma-separated list; take the first entry.
    const host = normalizeDomain(String(rawHost).split(",")[0]);

    if (host) {
      const { rows } = await db.query(
        `SELECT agency_name, logo_url, primary_color, secondary_color, support_email
         FROM agencies
         WHERE custom_domain = $1 AND is_active = TRUE`,
        [host],
      );
      if (rows[0]) {
        req.agencyBranding = {
          agencyName: rows[0].agency_name,
          logoUrl: rows[0].logo_url,
          primaryColor: rows[0].primary_color,
          secondaryColor: rows[0].secondary_color,
          supportEmail: rows[0].support_email,
        };
      }
    }
  } catch (err) {
    // Branding is optional — never let a lookup failure break the request.
    console.error("White-label middleware error:", err.message);
  }
  return next();
}

module.exports = whiteLabel;
