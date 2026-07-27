import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const STATUS_STYLES = {
  analyzed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  error: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const STATUS_LABELS = {
  analyzed: "Analyzed",
  pending: "Analyzing…",
  error: "Couldn't read",
};
const CHANGE_LABELS = {
  pricing: "Pricing",
  offer: "Offer",
  messaging: "Messaging",
  products: "Products",
  cta: "Call to action",
  redesign: "Redesign",
};

function Badge({ children, className }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function CompetitorSites({ brandId }) {
  const [sites, setSites] = useState([]);
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [firstLoaded, setFirstLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(
    async (spinner = false) => {
      if (!brandId) return;
      if (spinner) setLoading(true);
      setError("");
      try {
        const [sitesRes, digestRes] = await Promise.all([
          api.listCompetitorSites(brandId),
          Promise.resolve()
            .then(() => api.getCompetitorSiteDigest(brandId))
            .catch(() => null),
        ]);
        setSites((sitesRes && sitesRes.sites) || []);
        setDigest((digestRes && digestRes.digest) || null);
      } catch (err) {
        setError(err.message || "Failed to load competitor sites.");
      } finally {
        if (spinner) setLoading(false);
        setFirstLoaded(true);
      }
    },
    [brandId],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // While any site is still analyzing, poll quietly so the result appears without
  // a manual refresh (web_fetch analysis runs in the background after adding).
  useEffect(() => {
    if (!sites.some((s) => s.status === "pending")) return undefined;
    const id = setInterval(() => load(false), 8000);
    return () => clearInterval(id);
  }, [sites, load]);

  const addSite = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError("");
    setNotice("");
    try {
      await api.addCompetitorSite(brandId, url.trim(), label.trim());
      setUrl("");
      setLabel("");
      setNotice("Added. Scout is reading the site now — this can take a minute.");
      await load(false);
    } catch (err) {
      setError(err.message || "Failed to add the competitor site.");
    } finally {
      setAdding(false);
    }
  };

  const removeSite = async (siteId) => {
    setBusyId(siteId);
    setError("");
    setNotice("");
    try {
      await api.removeCompetitorSite(brandId, siteId);
      setSites((prev) => prev.filter((s) => s.siteId !== siteId));
    } catch (err) {
      setError(err.message || "Failed to remove the competitor site.");
    } finally {
      setBusyId("");
    }
  };

  const recheck = async (siteId) => {
    setBusyId(siteId);
    setError("");
    setNotice("");
    try {
      await api.recheckCompetitorSite(brandId, siteId);
      setNotice("Re-checking now — Scout will update this site shortly.");
      setSites((prev) =>
        prev.map((s) => (s.siteId === siteId ? { ...s, status: "pending" } : s)),
      );
      await load(false);
    } catch (err) {
      setError(err.message || "Failed to re-check the competitor site.");
    } finally {
      setBusyId("");
    }
  };

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to track its competitor websites.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Competitor Sites</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-400">
          Add a competitor's website and Scout reads it — their pricing, offers,
          messaging and calls-to-action. Scout then checks each site daily and
          alerts you to meaningful changes (a new price, a new offer, a messaging
          shift or a redesign). If a site blocks automated reading, Scout says so
          honestly — nothing is ever made up.
        </p>
      </div>

      <form
        onSubmit={addSite}
        className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="competitor.com"
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-sky-500 focus:outline-none"
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name (optional)"
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add site"}
          </button>
        </div>
      </form>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          {notice}
        </div>
      )}

      {sites.length > 0 && <DigestCard digest={digest} />}

      {loading && !firstLoaded ? (
        <Spinner />
      ) : sites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 p-6 text-center text-sm text-gray-400">
          No competitor websites yet. Add a competitor's URL above and Scout will
          analyze it and watch it for changes.
        </div>
      ) : (
        <div className="space-y-4">
          {sites.map((site) => (
            <SiteCard
              key={site.siteId}
              site={site}
              busy={busyId === site.siteId}
              onRemove={() => removeSite(site.siteId)}
              onRecheck={() => recheck(site.siteId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </h4>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-200">{value}</p>
    </div>
  );
}

function DigestCard({ digest }) {
  const d = digest || {};
  const total = d.totalChanges || 0;
  const byType = d.byType || [];

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-sky-100">This week's change digest</h3>
        <span className="text-[11px] uppercase tracking-wide text-sky-300/70">
          Last 7 days
        </span>
      </div>

      {total === 0 ? (
        <p className="mt-1.5 text-sm text-gray-300">
          No meaningful changes across your tracked competitor sites this week.
          Scout checks each site daily and will summarize anything that changes —
          nothing is ever made up.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm font-medium text-gray-100">
            {d.headline ||
              `${total} change${total === 1 ? "" : "s"} across ${
                d.sitesChanged || 0
              } competitor${d.sitesChanged === 1 ? "" : "s"} this week.`}
          </p>
          {byType.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {byType.map((b) => (
                <Badge
                  key={b.type}
                  className="border-sky-500/30 bg-sky-500/10 text-sky-200"
                >
                  {(CHANGE_LABELS[b.type] || b.type)} · {b.competitors}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SiteCard({ site, busy, onRemove, onRecheck }) {
  const status = site.status || "pending";
  const a = site.analysis || {};
  const changes = site.changes || [];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold text-gray-100">
              {site.label || hostOf(site.url)}
            </h3>
            <Badge className={STATUS_STYLES[status] || STATUS_STYLES.pending}>
              {STATUS_LABELS[status] || status}
            </Badge>
          </div>
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-300 hover:text-sky-200"
          >
            {site.url}
          </a>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Last checked {fmtDate(site.lastCheckedAt)}
            {site.lastChangedAt
              ? ` · last change ${fmtDate(site.lastChangedAt)}`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRecheck}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "…" : "Re-check"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="rounded-lg border border-rose-600/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-600/10 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      {status === "error" && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Scout couldn't read this site:{" "}
          {site.lastError || "the site blocked automated reading."} Nothing has
          been made up — try Re-check later, as some sites block bots temporarily.
        </div>
      )}

      {status === "pending" && (
        <p className="mt-3 text-sm text-gray-400">
          Scout is reading this site now. This usually takes under a minute.
        </p>
      )}

      {status === "analyzed" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Summary" value={a.summary} />
          <Field label="Positioning" value={a.positioning} />
          <Field label="Pricing" value={a.pricing} />
          <Field label="Offers & promos" value={a.offers} />
          <Field label="Messaging" value={a.messaging} />
          <Field label="Products & services" value={a.products} />
          <Field label="Calls to action" value={a.ctas} />
        </div>
      )}

      {changes.length > 0 && (
        <div className="mt-4 border-t border-gray-800 pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Changes Scout has flagged
          </h4>
          <ul className="mt-2 space-y-2">
            {changes.map((c) => (
              <li
                key={c.changeId}
                className="rounded-lg bg-gray-800/50 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-100">
                    {CHANGE_LABELS[c.changeType] || c.changeType}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {fmtDate(c.detectedAt)}
                  </span>
                </div>
                <p className="mt-1 text-gray-300">{c.summary}</p>
                {c.detail && (
                  <p className="mt-1 text-xs text-gray-500">{c.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
