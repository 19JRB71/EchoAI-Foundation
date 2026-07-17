import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "truth", label: "Company Truth" },
  { key: "brief", label: "Industry Brief" },
  { key: "feed", label: "Latest Intelligence" },
  { key: "competitors", label: "Competitor Watch" },
  { key: "insights", label: "Marketing Insights" },
  { key: "patterns", label: "Pattern Intelligence" },
  { key: "input", label: "Intelligence Input" },
];

const STATUS_STYLES = {
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  suggested: "bg-amber-500/15 text-amber-300 border-amber-500/30",
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

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(d);
  }
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

export default function Sage({ brandId, initialTab }) {
  const [tab, setTab] = useState(initialTab || "brief");

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a business to see Sage&apos;s industry intelligence.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: "#059669" }}
          >
            S
          </span>
          <h2 className="text-xl font-bold text-gray-100">
            Sage · Industry Intelligence
          </h2>
        </div>
        <p className="mt-2 text-sm text-gray-400">
          Sage continuously researches the live web for what&apos;s happening in
          your industry — trends, competitor moves, opportunities and threats —
          and turns it into a living brief with actionable recommendations.
          Always verify anything time-sensitive at the linked source.
        </p>
      </div>

      <SageV2Extras brandId={brandId} />

      <div className="flex flex-wrap gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "truth" && <CompanyTruthTab brandId={brandId} />}
      {tab === "brief" && <BriefTab brandId={brandId} />}
      {tab === "feed" && <FeedTab brandId={brandId} />}
      {tab === "competitors" && <CompetitorsTab brandId={brandId} />}
      {tab === "insights" && <InsightsTab brandId={brandId} />}
      {tab === "patterns" && <PatternsTab brandId={brandId} />}
      {tab === "input" && <InputTab brandId={brandId} />}
    </div>
  );
}

/* ------------------------------ Industry Brief ------------------------------ */

function BriefTab({ brandId }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { brief } = await api.getSageBrief(brandId);
      setBrief(brief);
    } catch (err) {
      setError(err.message || "Failed to load the industry brief");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const { brief } = await api.refreshSageBrief(brandId);
      setBrief(brief);
    } catch (err) {
      setError(err.message || "Failed to refresh the industry brief");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {brief && brief.last_refreshed_at
            ? `Last researched ${fmtDateTime(brief.last_refreshed_at)}`
            : "Not researched yet"}
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {refreshing ? "Researching…" : "Research now"}
        </button>
      </div>

      {!brief ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
          Sage hasn&apos;t built your industry brief yet. Click{" "}
          <span className="text-emerald-300">Research now</span> to run live
          research, or wait for the next scheduled cycle.
        </div>
      ) : (
        <div className="space-y-4">
          {brief.industry && (
            <p className="text-sm text-gray-300">
              <span className="text-gray-500">Industry:</span> {brief.industry}
            </p>
          )}
          {brief.summary && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-200">
                Executive summary
              </h3>
              <p className="whitespace-pre-line text-sm text-gray-300">
                {brief.summary}
              </p>
            </div>
          )}

          {Array.isArray(brief.sections) &&
            brief.sections.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-800 bg-gray-900/40 p-4"
              >
                <h3 className="mb-2 text-sm font-semibold text-emerald-300">
                  {s.title || `Section ${i + 1}`}
                </h3>
                {s.body && (
                  <p className="whitespace-pre-line text-sm text-gray-300">
                    {s.body}
                  </p>
                )}
                {Array.isArray(s.points) && s.points.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
                    {s.points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

          {Array.isArray(brief.sources) && brief.sources.length > 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-200">
                Sources
              </h3>
              <ul className="space-y-1 text-sm">
                {brief.sources.map((src, i) => {
                  const url = typeof src === "string" ? src : src.url;
                  const title =
                    typeof src === "string" ? src : src.title || src.url;
                  return (
                    <li key={i}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        {title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Latest Intelligence --------------------------- */

function FeedTab({ brandId }) {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const { feed } = await api.getSageFeed(brandId);
      setFeed(Array.isArray(feed) ? feed : []);
    } catch (err) {
      setError(err.message || "Failed to load the intelligence feed");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleItem = (feedId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(feedId)) next.delete(feedId);
      else next.add(feedId);
      return next;
    });
  };

  const allChecked = feed.length > 0 && selected.size === feed.length;
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(feed.map((i) => i.feed_id)));
  };

  const deleteItems = async ({ feedIds, all }) => {
    setDeleting(true);
    setError("");
    try {
      await api.dismissSageFeed(brandId, all ? { all: true } : { feedIds });
      if (all) {
        setFeed([]);
        setSelected(new Set());
      } else {
        const gone = new Set(feedIds);
        setFeed((prev) => prev.filter((i) => !gone.has(i.feed_id)));
        setSelected((prev) => {
          const next = new Set(prev);
          gone.forEach((id) => next.delete(id));
          return next;
        });
      }
    } catch (err) {
      setError(err.message || "Failed to delete feed items");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {feed.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
          No findings in the last 30 days yet. Sage&apos;s scheduled research
          will populate this feed automatically.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-emerald-500"
              />
              Select all
            </label>
            <span className="text-xs text-gray-500">
              {selected.size > 0 ? `${selected.size} selected` : `${feed.length} items`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={deleting || selected.size === 0}
                onClick={() => deleteItems({ feedIds: [...selected] })}
                className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete selected"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => deleteItems({ all: true })}
                className="rounded-md border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete all
              </button>
            </div>
          </div>
          <ul className="space-y-3">
          {feed.map((item) => (
            <li
              key={item.feed_id}
              className={`rounded-lg border bg-gray-900/40 p-4 ${
                item.urgent
                  ? "border-rose-500/40"
                  : "border-gray-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(item.feed_id)}
                    onChange={() => toggleItem(item.feed_id)}
                    aria-label="Select this finding"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-emerald-500"
                  />
                  {item.urgent && (
                    <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">
                      Urgent
                    </Badge>
                  )}
                  {item.source_type && (
                    <Badge className="bg-gray-700/40 text-gray-300 border-gray-600/40">
                      {item.source_type}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="whitespace-nowrap text-xs text-gray-500">
                    {fmtDateTime(item.created_at)}
                  </span>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => deleteItems({ feedIds: [item.feed_id] })}
                    aria-label="Delete this finding"
                    title="Delete"
                    className="text-gray-500 transition hover:text-rose-400 disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-200">{item.summary}</p>
              {item.why_it_matters && (
                <p className="mt-1 text-sm text-gray-400">
                  <span className="text-gray-500">Why it matters: </span>
                  {item.why_it_matters}
                </p>
              )}
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs text-emerald-400 hover:underline"
                >
                  {item.source_title || item.url}
                </a>
              )}
            </li>
          ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ---------------------------- Competitor Watch ---------------------------- */

function CompetitorsTab({ brandId }) {
  const [competitors, setCompetitors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState({ name: "", website: "", facebook_page: "" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { competitors } = await api.getSageCompetitors(brandId);
      setCompetitors(Array.isArray(competitors) ? competitors : []);
    } catch (err) {
      setError(err.message || "Failed to load competitors");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setAdding(true);
    setError("");
    try {
      await api.addSageCompetitor({ brandId, ...form });
      setForm({ name: "", website: "", facebook_page: "" });
      await load();
    } catch (err) {
      setError(err.message || "Failed to add competitor");
    } finally {
      setAdding(false);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setError("");
    try {
      const { competitors } = await api.suggestSageCompetitors(brandId);
      setCompetitors(Array.isArray(competitors) ? competitors : []);
    } catch (err) {
      setError(err.message || "Failed to suggest competitors");
    } finally {
      setSuggesting(false);
    }
  }

  async function refreshOne(id) {
    setBusyId(id);
    setError("");
    try {
      const { competitor } = await api.refreshSageCompetitor(brandId, id);
      setCompetitors((prev) =>
        prev.map((c) => (c.competitor_id === id ? competitor : c)),
      );
    } catch (err) {
      setError(err.message || "Failed to refresh competitor");
    } finally {
      setBusyId("");
    }
  }

  async function setStatus(id, status) {
    setBusyId(id);
    setError("");
    try {
      await api.updateSageCompetitor(brandId, id, status);
      await load();
    } catch (err) {
      setError(err.message || "Failed to update competitor");
    } finally {
      setBusyId("");
    }
  }

  async function remove(id) {
    setBusyId(id);
    setError("");
    try {
      await api.deleteSageCompetitor(brandId, id);
      setCompetitors((prev) => prev.filter((c) => c.competitor_id !== id));
    } catch (err) {
      setError(err.message || "Failed to remove competitor");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          The competitors Sage tracks for you. Suggested ones come from live
          research — confirm the ones worth watching.
        </p>
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting}
          className="whitespace-nowrap rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {suggesting ? "Finding…" : "Suggest competitors"}
        </button>
      </div>

      <form
        onSubmit={add}
        className="grid gap-2 rounded-lg border border-gray-800 bg-gray-900/40 p-4 sm:grid-cols-4"
      >
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Competitor name"
          className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <input
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
          placeholder="Website (optional)"
          className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <input
          value={form.facebook_page}
          onChange={(e) => setForm({ ...form, facebook_page: e.target.value })}
          placeholder="Facebook page (optional)"
          className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <button
          type="submit"
          disabled={adding || !form.name.trim()}
          className="rounded-md bg-gray-700 px-3 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {loading ? (
        <Spinner />
      ) : competitors.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
          No competitors yet. Add one above or let Sage suggest some.
        </div>
      ) : (
        <ul className="space-y-3">
          {competitors.map((c) => (
            <li
              key={c.competitor_id}
              className="rounded-lg border border-gray-800 bg-gray-900/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-100">
                      {c.name}
                    </span>
                    <Badge
                      className={
                        STATUS_STYLES[c.status] ||
                        "bg-gray-700/40 text-gray-300 border-gray-600/40"
                      }
                    >
                      {c.status}
                    </Badge>
                  </div>
                  {c.website && (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      {c.website}
                    </a>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {c.last_checked_at
                    ? `Checked ${fmtDate(c.last_checked_at)}`
                    : "Not checked yet"}
                </span>
              </div>

              {(c.follower_count != null ||
                c.last_post ||
                c.ad_activity) && (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
                  {c.follower_count != null && (
                    <span>Followers: {c.follower_count}</span>
                  )}
                  {c.last_post && <span>Last post: {c.last_post}</span>}
                  {c.ad_activity && <span>Ads: {c.ad_activity}</span>}
                </div>
              )}

              {c.strategy_summary && (
                <p className="mt-2 text-sm text-gray-300">
                  {c.strategy_summary}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => refreshOne(c.competitor_id)}
                  disabled={busyId === c.competitor_id}
                  className="rounded-md bg-gray-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-600 disabled:opacity-50"
                >
                  {busyId === c.competitor_id ? "Working…" : "Refresh"}
                </button>
                {c.status === "suggested" && (
                  <button
                    type="button"
                    onClick={() => setStatus(c.competitor_id, "confirmed")}
                    disabled={busyId === c.competitor_id}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStatus(c.competitor_id, "dismissed")}
                  disabled={busyId === c.competitor_id}
                  className="rounded-md bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.competitor_id)}
                  disabled={busyId === c.competitor_id}
                  className="rounded-md bg-rose-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------- Marketing Insights --------------------------- */

function InsightsTab({ brandId }) {
  const [insights, setInsights] = useState([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { insights, lastRefreshedAt } = await api.getSageInsights(brandId);
      setInsights(Array.isArray(insights) ? insights : []);
      setLastRefreshedAt(lastRefreshedAt || null);
    } catch (err) {
      setError(err.message || "Failed to load marketing insights");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      <p className="text-xs text-gray-500">
        {lastRefreshedAt
          ? `From the brief last researched ${fmtDateTime(lastRefreshedAt)}`
          : "No brief researched yet"}
      </p>
      {insights.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
          No insights yet. Once Sage researches your industry, actionable
          recommendations appear here.
        </div>
      ) : (
        <ul className="space-y-3">
          {insights.map((ins, i) => {
            if (typeof ins === "string") {
              return (
                <li
                  key={i}
                  className="rounded-lg border border-gray-800 bg-gray-900/40 p-4"
                >
                  <p className="whitespace-pre-line text-sm text-gray-300">
                    {ins}
                  </p>
                </li>
              );
            }
            const headline = ins.insight || ins.title || ins.headline;
            const action = ins.action || ins.recommendation;
            const why = ins.why || ins.body || ins.detail;
            return (
              <li
                key={i}
                className="rounded-lg border border-gray-800 bg-gray-900/40 p-4"
              >
                {headline && (
                  <h3 className="mb-1 text-sm font-semibold text-emerald-300">
                    {headline}
                  </h3>
                )}
                {action && (
                  <p className="whitespace-pre-line text-sm text-gray-200">
                    <span className="text-gray-500">Do this: </span>
                    {action}
                  </p>
                )}
                {why && (
                  <p className="mt-1 whitespace-pre-line text-sm text-gray-400">
                    <span className="text-gray-500">Why: </span>
                    {why}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------- Pattern Intelligence --------------------------- */

function PatternsTab({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.getSagePatterns(brandId);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load pattern intelligence");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function runStudy() {
    setRunning(true);
    setError("");
    try {
      const res = await api.refreshSagePatterns(brandId);
      setData((prev) => ({ ...(prev || {}), insights: res.insights }));
    } catch (err) {
      setError(err.message || "Failed to run the pattern study");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <Spinner />;

  const insights = data && data.insights;
  const report = insights && Array.isArray(insights.report) ? insights.report : [];
  const brief = insights && insights.forge_brief;
  const sources = insights && Array.isArray(insights.sources) ? insights.sources : [];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-sm text-gray-400">
        Sage studies <span className="text-gray-200">publicly available marketing</span>{" "}
        across your whole industry — public ad libraries and live web research —
        to learn <span className="text-gray-200">why</span> campaigns work, then
        hands Forge a creative brief so your content uses proven patterns while
        staying <span className="text-emerald-300">completely original</span>.
        Zorecho never copies another company&apos;s branding, copy, or imagery.
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {insights && insights.last_run_at
            ? `Last studied ${fmtDateTime(insights.last_run_at)} · ${insights.sample_size} public campaign${insights.sample_size === 1 ? "" : "s"} analyzed`
            : "No pattern study yet"}
        </p>
        <button
          type="button"
          onClick={runStudy}
          disabled={running}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {running ? "Studying…" : "Run pattern study"}
        </button>
      </div>

      {data && !data.adLibraryConfigured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Facebook access isn&apos;t configured, so Sage can&apos;t pull public
          Ad Library campaigns — pattern studies will rest on live web research
          only.
        </div>
      )}

      {!insights ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
          Sage hasn&apos;t studied your industry&apos;s patterns yet. Click{" "}
          <span className="text-emerald-300">Run pattern study</span> or wait
          for the weekly cycle (Tuesdays).
        </div>
      ) : (
        <div className="space-y-4">
          {brief && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <h3 className="mb-2 text-sm font-semibold text-emerald-300">
                Creative Brief → Forge
              </h3>
              <p className="mb-3 text-xs text-gray-500">
                These recommendations now steer Forge&apos;s creative choices
                for your weekly content (your own real engagement data still
                has the final say).
              </p>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {[
                  ["Objective", brief.objective],
                  ["Tone", brief.tone],
                  ["Visual style", brief.visual_style],
                  ["Camera", brief.camera],
                  ["Copy style", brief.copy_style],
                  ["Hook approach", brief.recommended_hook],
                  ["Call to action", brief.recommended_cta],
                  ["Story angle", brief.recommended_story],
                  ["Color direction", brief.color_palette],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt>
                      <dd className="text-gray-200">{v}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}

          {report.map((item, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="text-sm font-semibold text-gray-200">{item.pattern}</h3>
              {item.evidence && (
                <p className="mt-1 text-xs text-gray-500">Evidence: {item.evidence}</p>
              )}
              {item.why_it_works && (
                <p className="mt-2 text-sm text-gray-300">{item.why_it_works}</p>
              )}
            </div>
          ))}

          {insights.sample_size > 0 && (
            <p className="text-xs text-gray-500">
              Patterns measure prevalence among currently active public ads
              (the Ad Library publishes no engagement numbers for commercial
              ads) plus cited live web research.
            </p>
          )}

          {sources.length > 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-200">Web sources</h3>
              <ul className="space-y-1 text-sm">
                {sources.map((src, i) => {
                  const url = typeof src === "string" ? src : src.url;
                  const title = typeof src === "string" ? src : src.title || src.url;
                  return (
                    <li key={i}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 hover:underline"
                      >
                        {title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Intelligence Input --------------------------- */

function InputTab({ brandId }) {
  const [type, setType] = useState("link");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { submissions } = await api.getSageSubmissions(brandId);
      setSubmissions(Array.isArray(submissions) ? submissions : []);
    } catch (err) {
      setError(err.message || "Failed to load submission history");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitLink(e) {
    e.preventDefault();
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("Enter a valid http(s) URL");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.submitSageLink({ brandId, type, url: url.trim() });
      setUrl("");
      await load();
    } catch (err) {
      setError(err.message || "Failed to analyze the submission");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSubmitting(true);
    setError("");
    try {
      await api.submitSageFile(brandId, file);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err.message || "Failed to analyze the file");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} />}

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          Give Sage something to analyze
        </h3>
        <form onSubmit={submitLink} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            >
              <option value="link">Web link / article</option>
              <option value="facebook">Facebook page / ad</option>
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="min-w-[240px] flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>

        <div className="mt-4 border-t border-gray-800 pt-4">
          <label className="text-sm text-gray-400">
            …or upload an image or PDF (competitor flyer, screenshot, report):
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={submitFile}
            disabled={submitting}
            className="mt-2 block w-full text-sm text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-500 disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-200">
          Recent submissions
        </h3>
        {loading ? (
          <Spinner />
        ) : submissions.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing submitted yet.</p>
        ) : (
          <ul className="space-y-3">
            {submissions.map((s) => (
              <li
                key={s.submission_id}
                className="rounded-lg border border-gray-800 bg-gray-900/40 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-gray-700/40 text-gray-300 border-gray-600/40">
                      {s.input_type}
                    </Badge>
                    {s.title && (
                      <span className="text-sm font-semibold text-gray-100">
                        {s.title}
                      </span>
                    )}
                  </div>
                  <span className="whitespace-nowrap text-xs text-gray-500">
                    {fmtDateTime(s.created_at)}
                  </span>
                </div>
                {s.summary && (
                  <p className="mt-2 text-sm text-gray-300">{s.summary}</p>
                )}
                {Array.isArray(s.insights) && s.insights.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-400">
                    {s.insights.map((ins, i) => {
                      if (typeof ins === "string")
                        return <li key={i}>{ins}</li>;
                      const headline = ins.insight || ins.title;
                      const why = ins.why || ins.body || ins.detail;
                      return (
                        <li key={i}>
                          {headline}
                          {why ? (
                            <span className="text-gray-500"> — {why}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {s.input_ref && /^https?:\/\//i.test(s.input_ref) && (
                  <a
                    href={s.input_ref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-emerald-400 hover:underline"
                  >
                    {s.input_ref}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Company Truth ------------------------------ */

const TRUTH_SECTIONS = [
  ["identity", "Company identity & contact"],
  ["onlinePresence", "Website & connected accounts"],
  ["classification", "Industry & exact business classification"],
  ["productsServices", "Products & services"],
  ["serviceArea", "Service area"],
  ["targetCustomers", "Target customers"],
  ["businessModel", "Business model"],
  ["pricing", "Pricing / offer structure"],
  ["valuesPromises", "Company values & promises"],
  ["strengths", "Strengths & differentiators"],
  ["competitors", "Approved competitors"],
  ["terminology", "Industry terminology"],
  ["excludedCategories", "Excluded / commonly confused categories"],
  ["reputation", "Public reputation & review themes"],
  ["assets", "Uploaded & authorized assets"],
  ["currentMarketing", "Current marketing activity"],
  ["opportunitiesThreats", "Opportunities & threats"],
  ["missingInformation", "Missing information"],
];

function sectionText(v) {
  if (Array.isArray(v)) return v.join("\n");
  return typeof v === "string" ? v : "";
}

function TruthSection({ sectionKey, label, value, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isList = Array.isArray(value);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const content = isList
        ? draft.split("\n").map((l) => l.trim()).filter(Boolean)
        : draft.trim();
      await onSave(sectionKey, content);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Failed to save your edit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-200">{label}</h4>
        {editable && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(sectionText(value));
              setEditing(true);
            }}
            className="text-xs text-emerald-400 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={isList ? 6 : 4}
            className="w-full rounded-md border border-gray-700 bg-gray-950 p-2 text-sm text-gray-200"
          />
          {isList && (
            <p className="text-[11px] text-gray-500">One item per line.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : isList ? (
        value.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
            {value.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">Nothing listed.</p>
        )
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm text-gray-300">{value}</p>
      )}
    </div>
  );
}

function TruthReport({ report, editable, onSave }) {
  if (!report || !report.report) return null;
  return (
    <div className="space-y-3">
      {TRUTH_SECTIONS.map(([key, label]) => (
        <TruthSection
          key={key}
          sectionKey={key}
          label={label}
          value={report.report[key]}
          editable={editable}
          onSave={onSave}
        />
      ))}
    </div>
  );
}

// The business's own website + Facebook page — Sage researches these directly
// when building the Company Intelligence Report, so we ask for them right here.
function BusinessLinksCard({ brandId }) {
  const [website, setWebsite] = useState("");
  const [facebookPage, setFacebookPage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError("");
    api
      .getBrand(brandId)
      .then((brand) => {
        if (cancelled) return;
        setWebsite(brand.website_url || "");
        setFacebookPage(brand.facebook_page_url || "");
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // Don't show editable (empty) inputs we couldn't prefill — saving
        // them would silently clear real stored links.
        setLoadError(err.message || "Couldn't load your saved business links.");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const save = async () => {
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const updated = await api.updateBrand(brandId, {
        websiteUrl: website,
        facebookPageUrl: facebookPage,
      });
      setWebsite(updated.website_url || "");
      setFacebookPage(updated.facebook_page_url || "");
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="text-sm font-semibold text-gray-200">Your business online</h3>
      <p className="mt-1 text-sm text-gray-400">
        Sage researches your real website and Facebook page when building this
        report. Add them here so the research is grounded in your actual
        business.
      </p>
      {loadError ? (
        <p className="mt-2 text-sm text-red-400">{loadError}</p>
      ) : (
        <>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-gray-400">Website address</span>
          <input
            value={website}
            onChange={(e) => { setWebsite(e.target.value); setSaved(false); }}
            placeholder="e.g. https://yourbusiness.com"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-400">Facebook page</span>
          <input
            value={facebookPage}
            onChange={(e) => { setFacebookPage(e.target.value); setSaved(false); }}
            placeholder="e.g. facebook.com/yourbusiness"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>
      {saveError && <p className="mt-2 text-sm text-red-400">{saveError}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save business links"}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved.</span>}
      </div>
        </>
      )}
    </div>
  );
}

function CompanyTruthTab({ brandId }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [researchNote, setResearchNote] = useState("");
  const [showResearch, setShowResearch] = useState(false);
  const [notice, setNotice] = useState("");
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    setError("");
    try {
      const data = await api.getCompanyTruth(brandId);
      setState(data);
    } catch (err) {
      setError(err.message || "Failed to load the Company Truth");
    } finally {
      firstLoad.current = false;
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    firstLoad.current = true;
    // Switching brands: wipe messages from the previous brand so a stale
    // "finished" notice can't sit next to the new brand's "researching" banner,
    // and reset the transition tracker so Brand A's in-progress run can't make
    // Brand B falsely announce "finished".
    wasGenerating.current = false;
    setNotice("");
    setError("");
    load();
  }, [load]);

  // While Sage is researching on the server, poll every 5s — the run lives on
  // the server, so it survives leaving this page and coming back.
  const generating = !!state?.generating;
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (!generating) {
      if (wasGenerating.current) {
        wasGenerating.current = false;
        if (state?.lastError) setError(state.lastError);
        else setNotice("Sage finished the report. Review it below.");
      }
      return undefined;
    }
    if (!wasGenerating.current) {
      // A research run just started (or was already running when we arrived):
      // the amber banner announces it, so drop any leftover green notice —
      // "finished" and "researching" must never show together.
      setNotice("");
    }
    wasGenerating.current = true;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [generating, load, state?.lastError]);

  async function run(label, fn) {
    setWorking(label);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setWorking("");
    }
  }

  const generate = () =>
    run("generate", async () => {
      await api.generateCompanyTruth(brandId);
      setNotice("Sage is researching your company. This takes a few minutes — you can leave this page and come back.");
    });

  const approve = () =>
    run("approve", async () => {
      await api.approveCompanyTruth(brandId);
      setNotice("Approved. This is now the official Company Truth.");
    });

  const submitResearch = () =>
    run("research", async () => {
      await api.requestCompanyTruthResearch(brandId, researchNote);
      await api.generateCompanyTruth(brandId);
      setResearchNote("");
      setShowResearch(false);
      setNotice("Sage is re-researching with your notes. This takes a few minutes — you can leave this page and come back.");
    });

  const saveSection = async (section, content) => {
    await api.editCompanyTruthSection(brandId, section, content);
    await load();
  };

  if (loading) return <Spinner />;

  const pending = state?.pending || null;
  const approved = state?.approved || null;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} />}
      {!error && !generating && state?.lastError && <ErrorBanner message={state.lastError} />}
      {generating && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Sage is researching your company right now. This takes a few minutes —
          it keeps working even if you leave this page. The report will appear
          here when it&apos;s ready.
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <h3 className="text-sm font-semibold text-gray-200">
          The Company Truth
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Sage studies your real data and builds a Company Intelligence Report —
          who you are, exactly what you sell, and what you are NOT. Nothing is
          shared with the other departments until you approve it. Approve it,
          edit any section, or send Sage back to research more.
        </p>
      </div>

      <BusinessLinksCard brandId={brandId} />

      {!pending && !approved && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center">
          <p className="text-sm text-gray-400">
            Sage hasn&apos;t built your Company Intelligence Report yet.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={!!working || generating}
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {working === "generate" || generating ? "Sage is researching…" : "Build my report"}
          </button>
        </div>
      )}

      {pending && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                Awaiting your approval
              </Badge>
              <span className="text-xs text-gray-500">
                Version {pending.version} · generated {fmtDateTime(pending.generatedAt)}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={approve}
                disabled={!!working}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {working === "approve" ? "Approving…" : "Approve report"}
              </button>
              <button
                type="button"
                onClick={() => setShowResearch((v) => !v)}
                disabled={!!working}
                className="rounded-md border border-gray-700 px-4 py-1.5 text-sm text-gray-300 hover:text-gray-100 disabled:opacity-50"
              >
                Request more research
              </button>
            </div>
          </div>

          {showResearch && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <p className="text-sm text-gray-300">
                Tell Sage what it got wrong or what to dig into, and it will
                rebuild the report.
              </p>
              <textarea
                value={researchNote}
                onChange={(e) => setResearchNote(e.target.value)}
                rows={3}
                placeholder='e.g. "We build pole barns — we are not a storage facility. Research the post-frame construction market."'
                className="mt-2 w-full rounded-md border border-gray-700 bg-gray-950 p-2 text-sm text-gray-200"
              />
              <button
                type="button"
                onClick={submitResearch}
                disabled={!!working || !researchNote.trim()}
                className="mt-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {working === "research" ? "Sage is re-researching…" : "Send to Sage"}
              </button>
            </div>
          )}

          {pending.plainSummary && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <h4 className="text-sm font-semibold text-gray-200">
                Sage&apos;s summary
              </h4>
              <p className="mt-2 whitespace-pre-line text-sm text-gray-300">
                {pending.plainSummary}
              </p>
            </div>
          )}

          <TruthReport report={pending} editable onSave={saveSection} />
        </div>
      )}

      {approved && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                Approved Company Truth
              </Badge>
              <span className="text-xs text-gray-500">
                Version {approved.version} · approved {fmtDateTime(approved.approvedAt)}
              </span>
            </div>
            {!pending && (
              <button
                type="button"
                onClick={generate}
                disabled={!!working}
                className="rounded-md border border-gray-700 px-4 py-1.5 text-sm text-gray-300 hover:text-gray-100 disabled:opacity-50"
              >
                {working === "generate"
                  ? "Sage is researching…"
                  : "Refresh with new research"}
              </button>
            )}
          </div>
          {!pending && approved.plainSummary && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
              <h4 className="text-sm font-semibold text-gray-200">
                Sage&apos;s summary
              </h4>
              <p className="mt-2 whitespace-pre-line text-sm text-gray-300">
                {approved.plainSummary}
              </p>
            </div>
          )}
          {!pending && <TruthReport report={approved} editable={false} />}
          {pending && (
            <p className="text-xs text-gray-500">
              Version {approved.version} stays in force until you approve the
              new draft above.
            </p>
          )}
        </div>
      )}

      {state?.history?.length > 0 && (
        <p className="text-xs text-gray-500">
          Previous versions:{" "}
          {state.history
            .map((h) => `v${h.version} (approved ${fmtDate(h.approvedAt)})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * Sage V2 P1 extras — both flag-gated SERVER-side (SAGE_V2_CONTEXT /
 * SAGE_V2_WEEKLY_BRIEFING, default off): the endpoints answer
 * { enabled: false } while dark, so nothing renders for users until the CEO
 * approves the final copy and the flags are switched on. All wording comes
 * from config/briefingCopy.js DRAFT placeholders via the API.
 */
function SageV2Extras({ brandId }) {
  const [stats, setStats] = useState(null);
  const [weekly, setWeekly] = useState(null);

  useEffect(() => {
    let alive = true;
    setStats(null);
    setWeekly(null);
    api
      .getSageContextStats(brandId)
      .then((d) => alive && setStats(d))
      .catch(() => {});
    api
      .getSageWeeklyBriefing(brandId)
      .then((d) => alive && setWeekly(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [brandId]);

  const showBanner = stats?.enabled && !stats.hasApprovedTruth;
  const briefing = weekly?.enabled ? weekly.briefing : null;
  if (!showBanner && !briefing) return null;

  return (
    <div className="space-y-4">
      {showBanner && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          {stats.copy?.banner}
        </div>
      )}
      {briefing && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-100">
            {weekly.copy?.title}{" "}
            <span className="ml-2 text-xs font-normal text-gray-500">{briefing.iso_week}</span>
          </h3>
          <p className="mt-1 text-xs text-gray-400">{weekly.copy?.intro}</p>
          <div className="mt-4 space-y-4">
            {(briefing.sections || []).map((s) => (
              <div key={s.key}>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  {s.title}
                </p>
                {s.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{s.body}</p>
                ) : s.available ? (
                  <p className="mt-1 text-sm text-gray-300">
                    {Object.entries(s.data || {})
                      .filter(([, v]) => v != null && typeof v !== "object")
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ") || "Available."}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          {(briefing.sections || []).some((s) => !s.available) && (
            <p className="mt-4 text-xs text-gray-600">{weekly.copy?.unavailableNote}</p>
          )}
        </div>
      )}
    </div>
  );
}
