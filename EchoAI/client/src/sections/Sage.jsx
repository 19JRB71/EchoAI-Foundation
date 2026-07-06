import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "brief", label: "Industry Brief" },
  { key: "feed", label: "Latest Intelligence" },
  { key: "competitors", label: "Competitor Watch" },
  { key: "insights", label: "Marketing Insights" },
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

      {tab === "brief" && <BriefTab brandId={brandId} />}
      {tab === "feed" && <FeedTab brandId={brandId} />}
      {tab === "competitors" && <CompetitorsTab brandId={brandId} />}
      {tab === "insights" && <InsightsTab brandId={brandId} />}
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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
                <span className="whitespace-nowrap text-xs text-gray-500">
                  {fmtDateTime(item.created_at)}
                </span>
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
