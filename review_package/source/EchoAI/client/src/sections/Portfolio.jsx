import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "health", label: "Health Trajectory" },
  { key: "intelligence", label: "Cross-Business Intelligence" },
  { key: "team", label: "Team" },
];

const HEALTH_STYLES = {
  green: "bg-green-500/15 text-green-300 border-green-500/30",
  yellow: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const CATEGORY_LABELS = {
  shared_audience: "Shared Audience",
  cross_referral: "Cross-Referral",
  resource_allocation: "Resource Allocation",
  skill_transfer: "Skill Transfer",
  attention_allocation: "Attention Allocation",
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

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

function HealthBadge({ health }) {
  if (!health) {
    return <Badge className="bg-gray-600/20 text-gray-300 border-gray-600/40">No score yet</Badge>;
  }
  return (
    <Badge className={HEALTH_STYLES[health.status] || HEALTH_STYLES.yellow}>
      {health.score}/10
    </Badge>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function OverviewTab({ data }) {
  const { businesses, summary, approvals, hotLeads, echoBusiness } = data;

  if (!businesses.length && !echoBusiness) {
    return (
      <p className="text-sm text-gray-400">
        You don&apos;t have any businesses yet. Once you add a business, Echo will track it here
        across your whole portfolio.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <SummaryStat label="Businesses" value={summary.businessCount} />
        <SummaryStat label="Avg Health" value={summary.avgHealth != null ? `${summary.avgHealth}/10` : "—"} />
        <SummaryStat label="New Leads (7d)" value={summary.totalLeadsWeek} />
        <SummaryStat label="Revenue" value={money(summary.totalRevenueWeek)} />
        <SummaryStat label="Ad Spend" value={money(summary.totalAdSpend)} />
        <SummaryStat label="Hot Leads" value={summary.hotLeadCount} />
        <SummaryStat label="Approvals" value={summary.pendingApprovals} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Your Businesses
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {businesses.map((b) => (
            <div
              key={b.brandId}
              className="rounded-xl border border-gray-700 bg-gray-800/40 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-white">{b.name}</h4>
                <HealthBadge health={b.health} />
              </div>
              {b.health?.drivers && (
                <p className="mt-1 text-xs text-gray-400">{b.health.drivers}</p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-white">{b.week.leads}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Leads 7d</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{money(b.week.revenue)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Revenue</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{money(b.week.adSpend)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Ad Spend</div>
                </div>
              </div>
              {b.mostUrgent && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {b.mostUrgent}
                </div>
              )}
            </div>
          ))}

          {echoBusiness && (
            <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-teal-200">{echoBusiness.name}</h4>
                <Badge className="bg-teal-500/20 text-teal-200 border-teal-500/40">Platform</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-white">{money(echoBusiness.metrics.mrr)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">MRR</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{echoBusiness.metrics.payingCustomers}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Customers</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{echoBusiness.metrics.newSignups7d}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Signups 7d</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{echoBusiness.metrics.churned30d}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Churned 30d</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Unified Approval Queue
          </h3>
          {approvals.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing waiting for your approval right now.</p>
          ) : (
            <ul className="space-y-2">
              {approvals.map((a) => (
                <li
                  key={a.actionId}
                  className="rounded-lg border border-gray-700 bg-gray-800/40 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">{a.title}</span>
                    {a.risk === "high" && (
                      <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">
                        High risk
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {a.brandName || "Account-wide"}
                    {a.agent ? ` · ${a.agent}` : ""}
                  </div>
                  {a.detail && <p className="mt-1 text-xs text-gray-500">{a.detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Unified Hot Leads
          </h3>
          {hotLeads.length === 0 ? (
            <p className="text-sm text-gray-500">No hot leads across your businesses right now.</p>
          ) : (
            <ul className="space-y-2">
              {hotLeads.map((l) => (
                <li
                  key={l.leadId}
                  className="rounded-lg border border-gray-700 bg-gray-800/40 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">{l.name || "Unnamed lead"}</span>
                    <span className="text-[11px] text-gray-500">{fmtDate(l.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {l.brandName}
                    {l.email ? ` · ${l.email}` : ""}
                    {l.phone ? ` · ${l.phone}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Trajectory({ points }) {
  if (!points || points.length === 0) {
    return <p className="text-xs text-gray-500">No history yet — scores appear here as they accrue.</p>;
  }
  const max = 10;
  return (
    <div className="flex items-end gap-1" style={{ height: 60 }}>
      {points.map((p, i) => {
        const h = Math.max(4, (p.score / max) * 60);
        const color =
          p.status === "green" ? "#22c55e" : p.status === "red" ? "#f43f5e" : "#f59e0b";
        return (
          <div
            key={i}
            title={`${fmtDate(p.week)}: ${p.score}/10`}
            style={{ height: h, width: 10, backgroundColor: color }}
            className="rounded-t"
          />
        );
      })}
    </div>
  );
}

function HealthTab({ health, onRun, running }) {
  const perBrand = health?.perBrand || [];
  const latest = health?.latest || [];
  const latestById = Object.fromEntries(latest.map((l) => [l.brandId, l.health]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Each business gets a deterministic 1-10 health score every day. Bars show the last 12 weeks.
        </p>
        <button
          onClick={onRun}
          disabled={running}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {running ? "Scoring…" : "Recompute now"}
        </button>
      </div>

      {perBrand.length === 0 ? (
        <p className="text-sm text-gray-500">No businesses to score yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {perBrand.map((b) => (
            <div key={b.brandId} className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-white">{b.name}</h4>
                <HealthBadge health={latestById[b.brandId]} />
              </div>
              <div className="mt-4">
                <Trajectory points={b.points} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IntelligenceTab({ intel, onGenerate, generating, businessCount }) {
  const report = intel?.report;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          Echo studies your whole portfolio at once to find connections a single-business view misses.
        </p>
        <button
          onClick={onGenerate}
          disabled={generating || businessCount < 2}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {generating ? "Analyzing…" : report ? "Regenerate" : "Generate report"}
        </button>
      </div>

      {businessCount < 2 && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm text-gray-400">
          Cross-business intelligence needs at least two businesses. Add another business to unlock it.
        </div>
      )}

      {!report ? (
        businessCount >= 2 && (
          <p className="text-sm text-gray-500">No report yet — generate one to see cross-business opportunities.</p>
        )
      ) : (
        <div className="space-y-4">
          {intel.weekDate && (
            <p className="text-xs text-gray-500">Week of {fmtDate(intel.weekDate)}</p>
          )}
          {report.summary && (
            <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 text-sm text-teal-100">
              {report.summary}
            </div>
          )}
          <div className="space-y-3">
            {(report.insights || []).map((ins, i) => (
              <div key={i} className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-white">{ins.title}</h4>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-indigo-500/15 text-indigo-300 border-indigo-500/30">
                      {CATEGORY_LABELS[ins.category] || ins.category}
                    </Badge>
                    <Badge className="bg-gray-600/20 text-gray-300 border-gray-600/40">
                      Impact {ins.impactScore}/10
                    </Badge>
                  </div>
                </div>
                {ins.businesses?.length > 0 && (
                  <div className="mt-1 text-xs text-gray-400">{ins.businesses.join(" · ")}</div>
                )}
                <p className="mt-2 text-sm text-gray-300">{ins.insight}</p>
                <p className="mt-2 text-sm text-teal-200">
                  <span className="font-semibold">Next step:</span> {ins.recommendedAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamTab({ team }) {
  const members = team?.members || [];
  const summary = team?.summary;

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat label="Total" value={summary.total} />
          <SummaryStat label="Active" value={summary.active} />
          <SummaryStat label="Pending" value={summary.pending} />
          <SummaryStat label="Roles" value={Object.keys(summary.byRole || {}).length} />
        </div>
      )}
      {members.length === 0 ? (
        <p className="text-sm text-gray-500">No teammates yet across your account.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-800/60 text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {members.map((m) => (
                <tr key={m.teamMemberId}>
                  <td className="px-4 py-2 text-white">{m.email}</td>
                  <td className="px-4 py-2 capitalize text-gray-300">{String(m.role).replace("_", " ")}</td>
                  <td className="px-4 py-2 capitalize text-gray-300">{m.status}</td>
                  <td className="px-4 py-2 text-gray-400">{fmtDate(m.acceptedAt || m.invitedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Portfolio() {
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [intel, setIntel] = useState(null);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ov, he, it, tm] = await Promise.all([
        api.getPortfolioOverview(),
        api.getPortfolioHealth(),
        api.getPortfolioIntelligence(),
        api.getPortfolioTeam(),
      ]);
      setOverview(ov);
      setHealth(he);
      setIntel(it);
      setTeam(tm);
    } catch (err) {
      setError(err.message || "Failed to load your portfolio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runHealth = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      await api.runPortfolioHealth();
      const he = await api.getPortfolioHealth();
      setHealth(he);
      const ov = await api.getPortfolioOverview();
      setOverview(ov);
    } catch (err) {
      setError(err.message || "Failed to recompute health.");
    } finally {
      setRunning(false);
    }
  }, []);

  const generateIntel = useCallback(async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await api.generatePortfolioIntelligence();
      setIntel(res);
    } catch (err) {
      setError(err.message || "Failed to generate cross-business intelligence.");
    } finally {
      setGenerating(false);
    }
  }, []);

  if (loading) return <Spinner />;

  const businessCount = overview?.summary?.businessCount || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Portfolio</h2>
        <p className="mt-1 text-sm text-gray-400">
          Echo, your Multi-Business Chief of Staff — every business you run, in one place.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-wrap gap-2 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-teal-500 text-teal-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && overview && <OverviewTab data={overview} />}
      {tab === "health" && <HealthTab health={health} onRun={runHealth} running={running} />}
      {tab === "intelligence" && (
        <IntelligenceTab
          intel={intel}
          onGenerate={generateIntel}
          generating={generating}
          businessCount={businessCount}
        />
      )}
      {tab === "team" && <TeamTab team={team} />}
    </div>
  );
}
