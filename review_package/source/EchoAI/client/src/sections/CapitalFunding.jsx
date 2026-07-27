import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "opportunities", label: "Funding Opportunities" },
  { key: "briefing", label: "Opportunity Briefing" },
  { key: "pipeline", label: "Funding Pipeline" },
];

const REC_STYLES = {
  apply: "bg-green-500/15 text-green-300 border-green-500/30",
  consider: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  skip: "bg-gray-600/20 text-gray-300 border-gray-600/40",
};
const LEVEL_STYLES = {
  high: "bg-green-500/15 text-green-300 border-green-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-gray-600/20 text-gray-300 border-gray-600/40",
};
const APP_STATUS_STYLES = {
  draft: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  in_progress: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  submitted: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  awarded: "bg-green-500/15 text-green-300 border-green-500/30",
  declined: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const APP_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
];

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

function statusLabel(s) {
  const found = APP_STATUS_OPTIONS.find((o) => o.value === s);
  return found ? found.label : s;
}

export default function CapitalFunding({ brandId }) {
  const [tab, setTab] = useState("opportunities");

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to see its Capital &amp; Funding intelligence.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Capital &amp; Funding</h2>
        <p className="mt-1 text-sm text-gray-400">
          Scout scans grants and funding programs, ranks the strongest business
          opportunities each week, and Echo drafts complete grant applications
          from your brand and story. Always verify program details on the
          official page before applying.
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
                ? "border-sky-400 text-sky-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "opportunities" && <OpportunitiesTab brandId={brandId} />}
      {tab === "briefing" && <BriefingTab brandId={brandId} />}
      {tab === "pipeline" && <PipelineTab brandId={brandId} />}
    </div>
  );
}

/* --------------------------- Opportunities tab --------------------------- */

function OpportunitiesTab({ brandId }) {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [draftingId, setDraftingId] = useState("");
  const [dismissingId, setDismissingId] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getFundingOpportunities(brandId);
      setOpportunities(data.opportunities || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setOpportunities([]);
    setNotice("");
    load();
  }, [load]);

  async function handleScan() {
    setScanning(true);
    setError("");
    setNotice("");
    try {
      const data = await api.scanFunding(brandId);
      setOpportunities(data.opportunities || []);
      setNotice(`Scout surfaced ${data.scanned} funding programs.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function handleDraft(opportunityId) {
    setDraftingId(opportunityId);
    setError("");
    setNotice("");
    try {
      await api.draftGrantApplication(brandId, opportunityId);
      setNotice("Echo drafted a grant application. See the Funding Pipeline tab.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDraftingId("");
    }
  }

  async function handleDismiss(opportunityId) {
    setDismissingId(opportunityId);
    setError("");
    try {
      await api.dismissFundingOpportunity(brandId, opportunityId);
      setOpportunities((prev) =>
        prev.filter((o) => o.opportunityId !== opportunityId),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDismissingId("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          Funding programs Scout believes this business may qualify for, ranked
          by impact &times; probability.
        </p>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
        >
          {scanning ? "Scanning…" : "Scan for funding"}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          {notice}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : opportunities.length === 0 ? (
        <p className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-6 text-sm text-gray-400">
          No funding opportunities yet. Run a scan and Scout will research
          grants and programs that fit this business.
        </p>
      ) : (
        <ul className="space-y-3">
          {opportunities.map((o) => (
            <li
              key={o.opportunityId}
              className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-gray-100">
                    {o.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge className="border-gray-600/40 bg-gray-700/30 text-gray-300">
                      {o.source}
                    </Badge>
                    <Badge className={REC_STYLES[o.recommendation] || REC_STYLES.consider}>
                      {o.recommendation}
                    </Badge>
                    <span className="text-xs text-gray-400">
                      Fit {o.fitScore}/10 · Impact {o.impactScore}/10 · Odds{" "}
                      {o.probabilityScore}/10
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-100">
                    {o.awardAmount || "—"}
                  </p>
                  <p className="text-xs text-gray-500">{o.deadlineText || "—"}</p>
                </div>
              </div>

              <p className="mt-3 text-sm text-gray-300">{o.description}</p>
              <p className="mt-2 text-sm text-gray-400">
                <span className="font-medium text-gray-300">Eligibility:</span>{" "}
                {o.eligibility}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                <span className="font-medium text-gray-300">Scout&apos;s take:</span>{" "}
                {o.rationale}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDraft(o.opportunityId)}
                  disabled={draftingId === o.opportunityId || o.hasApplication}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
                >
                  {o.hasApplication
                    ? "Draft ready"
                    : draftingId === o.opportunityId
                      ? "Echo is writing…"
                      : "Have Echo draft it"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss(o.opportunityId)}
                  disabled={dismissingId === o.opportunityId}
                  className="text-sm text-gray-400 transition hover:text-gray-200 disabled:opacity-60"
                >
                  {dismissingId === o.opportunityId ? "Dismissing…" : "Dismiss"}
                </button>
                {o.officialUrl ? (
                  <a
                    href={o.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-sky-400 transition hover:text-sky-300"
                  >
                    Official page →
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------- Briefing tab ------------------------------ */

function BriefingTab({ brandId }) {
  const [briefing, setBriefing] = useState(null);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getOpportunityBriefing(brandId);
      setReady(Boolean(data.ready));
      setBriefing(data.briefing || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setBriefing(null);
    load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const data = await api.generateOpportunityBriefing(brandId);
      setReady(Boolean(data.ready));
      setBriefing(data.briefing || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          A weekly ranked read of business opportunities, competitor weaknesses,
          market trends, partnerships and trending topics.
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate briefing"}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {!briefing ? (
        <p className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-6 text-sm text-gray-400">
          {ready
            ? "No opportunity briefing yet. Generate one and Scout will study this business's data."
            : "No briefing available yet."}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Week of {fmtDate(briefing.weekDate)}
              </h3>
            </div>
            <p className="mt-2 text-sm text-gray-200">{briefing.summary}</p>
          </div>

          <BriefingList
            title="Ranked opportunities"
            items={briefing.opportunities}
            render={(o) => (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-gray-100">{o.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge className={LEVEL_STYLES[o.impact] || LEVEL_STYLES.low}>
                      Impact {o.impact}
                    </Badge>
                    <Badge className={LEVEL_STYLES[o.probability] || LEVEL_STYLES.low}>
                      Odds {o.probability}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-300">{o.detail}</p>
                {o.action ? (
                  <p className="mt-1 text-sm text-gray-400">
                    <span className="font-medium text-gray-300">Next move:</span>{" "}
                    {o.action}
                  </p>
                ) : null}
              </>
            )}
          />

          <BriefingList
            title="Competitor weaknesses"
            items={briefing.competitorWeaknesses}
            render={(c) => (
              <>
                <span className="font-semibold text-gray-100">
                  {c.competitor || "Competitor"}
                </span>
                <p className="mt-1 text-sm text-gray-300">{c.weakness}</p>
                {c.howToCapitalize ? (
                  <p className="mt-1 text-sm text-gray-400">
                    <span className="font-medium text-gray-300">
                      How to capitalize:
                    </span>{" "}
                    {c.howToCapitalize}
                  </p>
                ) : null}
              </>
            )}
          />

          <BriefingList
            title="Market trends"
            items={briefing.marketTrends}
            render={(t) => (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-100">{t.trend}</span>
                  <Badge className="border-gray-600/40 bg-gray-700/30 text-gray-300">
                    {t.direction}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-gray-300">{t.detail}</p>
              </>
            )}
          />

          <BriefingList
            title="Partnership ideas"
            items={briefing.partnerships}
            render={(p) => (
              <>
                <span className="font-semibold text-gray-100">{p.partner}</span>
                <p className="mt-1 text-sm text-gray-300">{p.rationale}</p>
              </>
            )}
          />

          <BriefingList
            title="Trending topics"
            items={briefing.trendingTopics}
            render={(t) => (
              <>
                <span className="font-semibold text-gray-100">{t.topic}</span>
                <p className="mt-1 text-sm text-gray-300">{t.angle}</p>
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}

function BriefingList({ title, items, render }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"
          >
            {render(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- Pipeline tab ------------------------------ */

function PipelineTab({ brandId }) {
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingId, setSavingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getFundingPipeline(brandId);
      setPipeline(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setPipeline(null);
    setOpenId("");
    setDetail(null);
    load();
  }, [load]);

  async function openApplication(applicationId) {
    if (openId === applicationId) {
      setOpenId("");
      setDetail(null);
      return;
    }
    setOpenId(applicationId);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      const data = await api.getGrantApplication(brandId, applicationId);
      setDetail(data.application || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function updateStatus(applicationId, status) {
    setSavingId(applicationId);
    setError("");
    try {
      await api.updateGrantApplication(brandId, applicationId, { status });
      await load();
      if (openId === applicationId) {
        const data = await api.getGrantApplication(brandId, applicationId);
        setDetail(data.application || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId("");
    }
  }

  if (loading) return <Spinner />;
  if (error && !pipeline) return <ErrorBanner message={error} />;
  if (!pipeline) return null;

  const { opportunities, applications, upcomingDeadlines } = pipeline;

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Opportunities" value={opportunities.identified} />
        <StatCard label="Recommended" value={opportunities.recommended} />
        <StatCard
          label="Drafted / in progress"
          value={pipeline.inProgress.length}
        />
        <StatCard label="Submitted" value={pipeline.submitted.length} />
      </div>

      {upcomingDeadlines.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Upcoming deadlines
          </h3>
          <ul className="space-y-2">
            {upcomingDeadlines.map((d) => (
              <li
                key={d.opportunityId}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-sm"
              >
                <span className="text-gray-200">{d.name}</span>
                <span className="text-gray-400">{fmtDate(d.deadline)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Grant applications
        </h3>
        {applications.length === 0 ? (
          <p className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-6 text-sm text-gray-400">
            No grant applications yet. Ask Echo to draft one from a funding
            opportunity.
          </p>
        ) : (
          <ul className="space-y-3">
            {applications.map((a) => (
              <li
                key={a.applicationId}
                className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-base font-semibold text-gray-100">
                      {a.grantName}
                    </h4>
                    <p className="mt-1 text-xs text-gray-500">
                      {a.awardAmount || "—"} · Updated {fmtDate(a.updatedAt)}
                    </p>
                  </div>
                  <Badge className={APP_STATUS_STYLES[a.status] || APP_STATUS_STYLES.draft}>
                    {statusLabel(a.status)}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openApplication(a.applicationId)}
                    className="text-sm text-sky-400 transition hover:text-sky-300"
                  >
                    {openId === a.applicationId ? "Hide draft" : "View draft"}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    Status
                    <select
                      value={a.status}
                      disabled={savingId === a.applicationId}
                      onChange={(e) =>
                        updateStatus(a.applicationId, e.target.value)
                      }
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 disabled:opacity-60"
                    >
                      {APP_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {openId === a.applicationId && (
                  <div className="mt-4 border-t border-gray-800 pt-4">
                    {detailLoading ? (
                      <Spinner />
                    ) : detail ? (
                      <div className="space-y-4">
                        {detail.draftSummary ? (
                          <p className="text-sm text-gray-300">
                            {detail.draftSummary}
                          </p>
                        ) : null}
                        {(detail.draftSections || []).map((s, i) => (
                          <div key={i}>
                            <h5 className="text-sm font-semibold text-gray-100">
                              {s.heading}
                            </h5>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">
                              {s.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">
                        Draft could not be loaded.
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 text-center">
      <p className="text-2xl font-bold text-gray-100">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
        {label}
      </p>
    </div>
  );
}
