// Advanced ROI Dashboard (Enterprise) — multi-channel dollar attribution across
// Facebook ads, phone, SMS, email, and website. Four tabs: Overview, Channel
// Breakdown, Revenue Attribution (funnel), and History. Dependency-free charts
// to match the rest of the dashboard.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function moneyShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function num(n) {
  return (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pct(n) {
  return n == null ? "—" : `${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
}

function roiColor(n) {
  if (n == null) return "text-gray-400";
  return Number(n) >= 0 ? "text-green-400" : "text-red-400";
}

const RANGES = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "custom", label: "Custom" },
];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channel Breakdown" },
  { key: "attribution", label: "Revenue Attribution" },
  { key: "history", label: "History" },
];

function BigStat({ label, value, sub, accent }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gradient-to-b from-gray-900 to-gray-900/40 p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-4xl font-extrabold tracking-tight ${accent || "text-amber-400"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

// 12-week ROI% trend as a dependency-free line chart (SVG).
function RoiTrendLine({ snapshots }) {
  const data = [...snapshots].reverse(); // oldest → newest
  if (data.length < 2) {
    return <p className="text-sm text-gray-400">Not enough history yet for a trend.</p>;
  }
  const vals = data.map((s) => Number(s.roi_percentage) || 0);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = max - min || 1;
  const W = 640;
  const H = 180;
  const pad = 24;
  const x = (i) => pad + (i * (W - pad * 2)) / (data.length - 1);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const points = data.map((s, i) => `${x(i)},${y(Number(s.roi_percentage) || 0)}`).join(" ");
  const zeroY = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#374151" strokeWidth="1" strokeDasharray="4 4" />
      <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((s, i) => (
        <circle key={s.snapshot_id || i} cx={x(i)} cy={y(Number(s.roi_percentage) || 0)} r="3" fill="#fbbf24" />
      ))}
    </svg>
  );
}

// Horizontal bar chart — leads generated per channel.
function LeadsBarChart({ channels }) {
  const max = Math.max(...channels.map((c) => c.leads || 0), 1);
  return (
    <div className="space-y-2.5">
      {channels.map((c) => (
        <div key={c.key} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs text-gray-400">{c.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-gray-800">
            <div
              className="h-full rounded bg-gradient-to-r from-amber-600 to-amber-400"
              style={{ width: `${Math.max((c.leads / max) * 100, c.leads ? 3 : 0)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs font-semibold text-gray-200">{num(c.leads)}</span>
        </div>
      ))}
    </div>
  );
}

function AnalysisCard({ analysis, onRefresh, refreshing, error }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">AI executive summary</h3>
          <p className="text-xs text-gray-500">What's driving your revenue this period, in plain English.</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {refreshing ? "Analyzing…" : analysis ? "Regenerate" : "Generate analysis"}
        </button>
      </div>
      <ErrorBanner message={error} />
      {analysis ? (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-800 bg-gray-950/40 p-4 text-sm leading-relaxed text-gray-200">
          {analysis.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">
          No analysis for this period yet. Generate one to get an AI breakdown of your channels.
        </p>
      )}
    </div>
  );
}

export default function AdvancedRoiDashboard({ brandId }) {
  const [range, setRange] = useState("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [tab, setTab] = useState("overview");

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [refreshing, setRefreshing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const rangeParams = useCallback(() => {
    if (range === "custom") {
      if (!customStart || !customEnd) return null;
      return { range: "custom", start: customStart, end: customEnd };
    }
    return { range };
  }, [range, customStart, customEnd]);

  const load = useCallback(async () => {
    if (!brandId) return;
    const params = rangeParams();
    if (!params) return; // custom range not fully chosen yet
    setLoading(true);
    setError("");
    try {
      const res = await api.getRoiAdvancedSummary(brandId, params);
      setSummary(res.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId, rangeParams]);

  useEffect(() => {
    setSummary(null);
    load();
  }, [load]);

  const loadHistory = useCallback(async () => {
    if (!brandId) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await api.getRoiAdvancedHistory(brandId);
      setHistory(res.snapshots || []);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (tab === "history" || tab === "overview") loadHistory();
  }, [tab, loadHistory]);

  async function handleGenerateAnalysis() {
    setRefreshing(true);
    setAnalysisError("");
    try {
      const params = rangeParams() || { range };
      const res = await api.generateRoiAdvancedAnalysis(brandId, params);
      if (res.summary) setSummary(res.summary);
      loadHistory();
    } catch (err) {
      setAnalysisError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function openSnapshot(snapshotId) {
    setDetailLoading(true);
    try {
      const res = await api.getRoiAdvancedSnapshot(brandId, snapshotId);
      setDetail(res.snapshot);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  if (!brandId)
    return <p className="text-sm text-gray-400">Select or create a brand to see your ROI.</p>;

  const totals = summary?.totals || {};
  const channels = summary?.channels || [];
  const funnel = summary?.funnel || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Advanced ROI</h2>
          <p className="mt-1 text-sm text-gray-400">
            Exactly how much revenue Zorecho is generating, with dollar attribution across every channel.
          </p>
        </div>
        {/* Date range selector */}
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                range === r.key
                  ? "bg-amber-500 text-gray-900"
                  : "border border-gray-700 text-gray-300 hover:bg-gray-800"
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
              />
              <span className="text-xs text-gray-500">→</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === t.key
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {loading && <Spinner label="Calculating your ROI…" />}

      {!loading && summary && tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BigStat label="Total spend" value={money(totals.spend)} sub={summary.period?.label} />
            <BigStat
              label="Revenue attributed"
              value={money(totals.revenue)}
              sub={`${num(totals.conversions)} conversions`}
              accent="text-green-400"
            />
            <BigStat
              label="Overall ROI"
              value={pct(totals.roiPercent)}
              sub="Return on marketing spend"
              accent={`text-5xl ${roiColor(totals.roiPercent)}`}
            />
            <BigStat label="Conversions" value={num(totals.conversions)} sub={`${num(totals.leads)} leads`} />
          </div>

          <AnalysisCard
            analysis={summary.analysis}
            onRefresh={handleGenerateAnalysis}
            refreshing={refreshing}
            error={analysisError}
          />

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-semibold text-gray-200">12-week ROI trend</h3>
            <p className="mb-4 text-xs text-gray-500">Overall ROI % from your saved weekly snapshots.</p>
            {historyLoading ? (
              <Spinner label="Loading trend…" />
            ) : (
              <RoiTrendLine snapshots={history} />
            )}
          </div>

          <RoiDisclaimer assumptions={summary.assumptions} />
        </div>
      )}

      {!loading && summary && tab === "channels" && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3 text-right">Spend</th>
                  <th className="px-4 py-3 text-right">Leads</th>
                  <th className="px-4 py-3 text-right">Appts</th>
                  <th className="px-4 py-3 text-right">Conv.</th>
                  <th className="px-4 py-3 text-right">Cost / Lead</th>
                  <th className="px-4 py-3 text-right">Cost / Conv.</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">ROI</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr
                    key={c.key}
                    className="border-b border-gray-800/60 last:border-0"
                    style={{
                      backgroundColor:
                        c.roiPercent == null
                          ? "transparent"
                          : c.roiPercent >= 0
                            ? "rgba(34,197,94,0.06)"
                            : "rgba(239,68,68,0.06)",
                    }}
                  >
                    <td className="px-4 py-3 font-medium text-gray-200">{c.label}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{money(c.spend)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{num(c.leads)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{num(c.appointments)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{num(c.conversions)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {c.costPerLead == null ? "—" : money(c.costPerLead)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {c.costPerConversion == null ? "—" : money(c.costPerConversion)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{money(c.revenue)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${roiColor(c.roiPercent)}`}>
                      {pct(c.roiPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-gray-200">Leads generated per channel</h3>
            <LeadsBarChart channels={channels} />
          </div>

          <RoiDisclaimer assumptions={summary.assumptions} />
        </div>
      )}

      {!loading && summary && tab === "attribution" && (
        <div className="space-y-6">
          {summary.bestConversion && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-green-800/50 bg-green-500/5 p-5">
                <p className="text-xs uppercase tracking-wide text-green-400">Best lead → conversion</p>
                <p className="mt-1 text-lg font-bold text-gray-100">{summary.bestConversion.label}</p>
                <p className="text-sm text-green-400">{pct(summary.bestConversion.rate)} convert</p>
              </div>
              {summary.worstConversion && (
                <div className="rounded-xl border border-red-800/50 bg-red-500/5 p-5">
                  <p className="text-xs uppercase tracking-wide text-red-400">Needs work</p>
                  <p className="mt-1 text-lg font-bold text-gray-100">{summary.worstConversion.label}</p>
                  <p className="text-sm text-red-400">{pct(summary.worstConversion.rate)} convert</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            {funnel.map((f) => (
              <div key={f.key} className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-200">{f.label}</h3>
                  <span className="text-xs text-gray-500">
                    {f.leadToConvRate == null ? "—" : `${pct(f.leadToConvRate)} lead → conversion`}
                  </span>
                </div>
                <FunnelBars
                  leads={f.leads}
                  appointments={f.appointments}
                  conversions={f.conversions}
                  leadToApptRate={f.leadToApptRate}
                  apptToConvRate={f.apptToConvRate}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4">
          <ErrorBanner message={historyError} />
          {historyLoading ? (
            <Spinner label="Loading history…" />
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400">
              No weekly snapshots yet. They're generated automatically every Monday, or when you
              regenerate the analysis above.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3 text-right">Spend</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">Leads</th>
                    <th className="px-4 py-3 text-right">Conv.</th>
                    <th className="px-4 py-3 text-right">ROI</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.snapshot_id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">
                        {s.period_start} → {s.period_end}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{money(s.total_spend)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{money(s.total_revenue)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{num(s.total_leads)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{num(s.total_conversions)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${roiColor(s.roi_percentage)}`}>
                        {pct(s.roi_percentage)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openSnapshot(s.snapshot_id)}
                          className="rounded-md border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-800"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detailLoading && <Spinner label="Loading snapshot…" />}
          {detail && (
            <SnapshotDetail snapshot={detail} onClose={() => setDetail(null)} />
          )}
        </div>
      )}
    </div>
  );
}

function FunnelBars({ leads, appointments, conversions, leadToApptRate, apptToConvRate }) {
  const max = Math.max(leads, appointments, conversions, 1);
  const stages = [
    { label: "Leads", value: leads, color: "from-amber-600 to-amber-400" },
    { label: "Appointments", value: appointments, color: "from-sky-600 to-sky-400", rate: leadToApptRate },
    { label: "Conversions", value: conversions, color: "from-green-600 to-green-400", rate: apptToConvRate },
  ];
  return (
    <div className="space-y-2.5">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-gray-400">{s.label}</span>
          <div className="h-6 flex-1 overflow-hidden rounded bg-gray-800">
            <div
              className={`flex h-full items-center justify-end rounded bg-gradient-to-r ${s.color} pr-2 text-[11px] font-semibold text-gray-900`}
              style={{ width: `${Math.max((s.value / max) * 100, s.value ? 6 : 0)}%` }}
            >
              {s.value > 0 ? num(s.value) : ""}
            </div>
          </div>
          <span className="w-24 shrink-0 text-right text-[11px] text-gray-500">
            {s.rate == null ? "" : `${pct(s.rate)} from prev.`}
          </span>
        </div>
      ))}
    </div>
  );
}

function SnapshotDetail({ snapshot, onClose }) {
  const breakdown = snapshot.channel_breakdown || {};
  const channels = breakdown.channels || [];
  return (
    <div className="rounded-xl border border-amber-800/40 bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">
          {snapshot.period_start} → {snapshot.period_end}
        </h3>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-200">
          Close ✕
        </button>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Spend" value={money(snapshot.total_spend)} />
        <Mini label="Revenue" value={money(snapshot.total_revenue)} />
        <Mini label="Conversions" value={num(snapshot.total_conversions)} />
        <Mini label="ROI" value={pct(snapshot.roi_percentage)} accent={roiColor(snapshot.roi_percentage)} />
      </div>
      {channels.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Conv.</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.key} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-3 py-2 text-gray-200">{c.label}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{money(c.spend)}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{num(c.leads)}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{num(c.conversions)}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{money(c.revenue)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${roiColor(c.roiPercent)}`}>{pct(c.roiPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {snapshot.ai_analysis && (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-800 bg-gray-950/40 p-4 text-sm leading-relaxed text-gray-200">
          {snapshot.ai_analysis.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${accent || "text-gray-100"}`}>{value}</p>
    </div>
  );
}

function RoiDisclaimer({ assumptions }) {
  const a = assumptions || {};
  return (
    <p className="text-xs text-gray-600">
      Revenue is attributed at {money(a.revenuePerConversion)}/converted customer. Facebook spend and
      leads come from your real ad analytics; phone, SMS, and email spend use per-unit estimates
      ({money(a.phoneCostPerMinute)}/min, {money(a.smsCostPerMessage)}/SMS, {money(a.emailCostPerSend)}/email)
      applied to your real activity. Channel attribution is multi-touch, so per-channel conversions can
      overlap; totals are computed from your real CRM data.
    </p>
  );
}
