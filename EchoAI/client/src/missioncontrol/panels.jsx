import { AGENTS_META } from "../lib/departments.js";

// Mission Control V2 — the panels around the Core. Every figure comes straight
// from the /v2 aggregation payload (real data); anything without data renders
// an honest empty/reserved state, never a fabricated number.

export function Panel({ title, accent = "#22d3ee", right, children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-cyan-950/70 bg-[#050b1d]/90 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
          {title}
        </div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

export function relTime(ts) {
  if (!ts) return "";
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function agentColor(agentId) {
  const meta = AGENTS_META.find((m) => m.id === agentId);
  return meta ? meta.color : "#22d3ee";
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------
const KPI_ICONS = {
  check: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  calendar: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
  phone: "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z",
  users: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  dollar: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  clock: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z",
};

export function KpiTile({ label, value, deltaPct, deltaLabel, accent = "#22d3ee", icon }) {
  const up = deltaPct != null && deltaPct > 0;
  const down = deltaPct != null && deltaPct < 0;
  return (
    <div
      className="rounded-2xl border border-cyan-950/70 bg-[#050b1d]/90 px-3.5 py-3"
      style={{ boxShadow: `inset 0 0 30px rgba(5,15,35,0.5)` }}
    >
      <div className="flex items-center gap-1.5">
        {icon && KPI_ICONS[icon] && (
          <svg className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={KPI_ICONS[icon]} />
          </svg>
        )}
        <div className="text-[10px] font-semibold leading-tight text-gray-400">{label}</div>
      </div>
      <div className="mt-1 text-[26px] font-extrabold leading-none text-gray-50" style={{ textShadow: `0 0 18px ${accent}44` }}>
        {value}
      </div>
      <div className="mt-1.5 text-[10.5px]">
        {deltaPct == null ? (
          <span className="text-gray-600">{deltaLabel || "no baseline yet"}</span>
        ) : (
          <span className={up ? "text-emerald-400" : down ? "text-rose-400" : "text-gray-500"}>
            {up ? "▲" : down ? "▼" : "—"} {Math.abs(deltaPct)}% {deltaLabel || "vs yesterday"}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zorecho Score
// ---------------------------------------------------------------------------
export function ZorechoScoreCard({ score }) {
  const s = score || {};
  const history = Array.isArray(s.history) ? s.history : [];
  const max = 100;
  const points = history.length
    ? history
        .map((h, i) => {
          const x = history.length === 1 ? 50 : (i / (history.length - 1)) * 100;
          const y = 34 - (Math.max(0, Math.min(max, h.score)) / max) * 30;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : null;

  return (
    <Panel title="Zorecho Score" accent="#67e8f9">
      <div className="flex items-start justify-between gap-3">
        <div>
          {s.score == null ? (
            <>
              <div className="text-lg font-bold text-gray-300">Not yet scored</div>
              <div className="mt-1 text-[11px] leading-snug text-gray-500">
                Set goals in Settings and your live company score appears here.
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-cyan-300">{s.label}</div>
              <div className="mt-0.5 text-[11px] text-gray-500">Goal achievement across your active goals</div>
            </>
          )}
        </div>
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border text-xl font-extrabold"
          style={{
            borderColor: s.score == null ? "#1f2a44" : "#22d3ee66",
            color: s.score == null ? "#475569" : "#a5f3fc",
            boxShadow: s.score == null ? "none" : "0 0 24px rgba(34,211,238,0.18)",
          }}
        >
          {s.grade || "—"}
        </div>
      </div>
      {points && (
        <svg viewBox="0 0 100 36" className="mt-3 h-12 w-full" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} fill="none" stroke="#22d3ee" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
      {s.score != null && (
        <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
          <span>{history.length ? `Last ${history.length} day${history.length === 1 ? "" : "s"}` : "History builds daily"}</span>
          <span className="font-semibold text-gray-300">{s.score}/100</span>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------
export function ActivityFeed({ items, onViewAll }) {
  const feed = Array.isArray(items) ? items : [];
  return (
    <Panel
      title="AI Activity Feed"
      accent="#67e8f9"
      right={
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px #34d399" }} />
          Live
        </span>
      }
    >
      {feed.length === 0 ? (
        <div className="py-3 text-[12px] text-gray-500">
          No activity yet — your AI team's real actions will appear here as they happen.
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {feed.slice(0, 8).map((e, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: agentColor(e.agentId), boxShadow: `0 0 6px ${agentColor(e.agentId)}` }}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">{e.text}</span>
                <span className="shrink-0 text-[10px] text-gray-600">{relTime(e.ts)}</span>
              </li>
            ))}
          </ul>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="mt-3 w-full text-center text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
            >
              View Full Activity →
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Needs Your Attention
// ---------------------------------------------------------------------------
export function AttentionPanel({ items, onNavigate }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <Panel
      title="Needs Your Attention"
      accent="#fda4af"
      right={
        list.length > 0 ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/90 text-[10px] font-bold text-white">
            {list.length}
          </span>
        ) : null
      }
    >
      {list.length === 0 ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-gray-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Nothing needs you right now — the team is running smoothly.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {list.slice(0, 5).map((a) => (
            <li key={a.id}>
              <button
                onClick={() => a.section && onNavigate && onNavigate(a.section)}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: a.priority === "high" ? "#f43f5e" : "#f59e0b" }}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300 hover:text-gray-100">{a.text}</span>
                <span
                  className="shrink-0 text-[10px] font-semibold uppercase"
                  style={{ color: a.priority === "high" ? "#fb7185" : "#fbbf24" }}
                >
                  {a.priority === "high" ? "High" : "Medium"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Bottom row panels
// ---------------------------------------------------------------------------
export function GlancePanel({ glance }) {
  const g = glance || {};
  const rows = [
    { label: "Posts Published", value: g.postsPublished, color: "#22d3ee" },
    { label: "New Leads", value: g.newLeads, color: "#34d399" },
    { label: "Calls Answered", value: g.callsAnswered, color: "#a78bfa" },
    { label: "Appointments", value: g.appointmentsBooked, color: "#f97316" },
    { label: "Issues Resolved", value: g.issuesResolved, color: "#f43f5e" },
    { label: "Reviews Responded", value: g.reviewsResponded, color: "#fbbf24" },
  ];
  return (
    <Panel title="Today at a Glance" accent="#fbbf24">
      {glance == null ? (
        <div className="py-2 text-[12px] text-gray-500">Add a business to see today's numbers.</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold"
                style={{ backgroundColor: `${r.color}1a`, color: r.color, border: `1px solid ${r.color}44` }}
              >
                {r.value ?? 0}
              </span>
              <span className="text-[10px] leading-tight text-gray-400">{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function RevenuePanel({ revenueImpact, revenueTrend }) {
  const trend = Array.isArray(revenueTrend) ? revenueTrend.filter((t) => t.revenue != null) : [];
  const maxRev = trend.length ? Math.max(...trend.map((t) => t.revenue), 1) : 1;
  return (
    <Panel title="Revenue Impact" accent="#34d399">
      {revenueImpact == null ? (
        <div className="py-2 text-[12px] leading-snug text-gray-500">
          Revenue impact appears once your AI team has activity to measure.
        </div>
      ) : (
        <>
          <div className="text-2xl font-extrabold text-gray-50">
            ${Number(revenueImpact.totalValueGenerated || 0).toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">
            Estimated value generated this {revenueImpact.period}
            <span className="ml-1 rounded bg-gray-800 px-1 py-px text-[9px] uppercase tracking-wide text-gray-400">estimate</span>
          </div>
          {trend.length > 0 && (
            <div className="mt-3">
              <div className="flex h-14 items-end gap-1.5">
                {trend.map((t, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${Math.max(6, (t.revenue / maxRev) * 100)}%`,
                      background: "linear-gradient(to top, #0e7490, #34d399)",
                      boxShadow: "0 0 8px rgba(52,211,153,0.25)",
                    }}
                    title={`$${Number(t.revenue).toLocaleString()}`}
                  />
                ))}
              </div>
              <div className="mt-1 flex gap-1.5">
                {trend.map((t, i) => (
                  <div key={i} className="flex-1 text-center text-[8px] uppercase text-gray-600">
                    {t.periodEnd
                      ? new Date(t.periodEnd).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
                      : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {trend.length === 0 && (
            <div className="mt-3 text-[11px] text-gray-600">Weekly trend builds as Advanced ROI snapshots accrue.</div>
          )}
        </>
      )}
    </Panel>
  );
}

// Donut arcs are the REAL breakdown proportions (share of total automated
// hours per task type) — never a fabricated "% of manual work" figure.
const DONUT_COLORS = ["#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#f97316"];

export function TimePanel({ timeSaved }) {
  const breakdown = Array.isArray(timeSaved?.breakdown)
    ? timeSaved.breakdown.filter((b) => Number(b.hours) > 0)
    : [];
  const totalBreak = breakdown.reduce((s, b) => s + Number(b.hours), 0);
  const R = 15.9155; // unit-circumference radius
  let offset = 25;
  const arcs = breakdown.slice(0, 5).map((b, i) => {
    const pct = totalBreak > 0 ? (Number(b.hours) / totalBreak) * 100 : 0;
    const arc = { pct, color: DONUT_COLORS[i % DONUT_COLORS.length], offset };
    offset -= pct;
    return arc;
  });
  return (
    <Panel title="Time Automated" accent="#a78bfa">
      {timeSaved == null ? (
        <div className="py-2 text-[12px] leading-snug text-gray-500">
          Hours saved appear once your AI team has completed real work.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="relative h-20 w-20 shrink-0">
              <svg viewBox="0 0 42 42" className="h-20 w-20 -rotate-90" aria-hidden="true">
                <circle cx="21" cy="21" r={R} fill="none" stroke="#111a30" strokeWidth="4" />
                {arcs.map((a, i) => (
                  <circle
                    key={i}
                    cx="21"
                    cy="21"
                    r={R}
                    fill="none"
                    stroke={a.color}
                    strokeWidth="4"
                    strokeDasharray={`${a.pct} ${100 - a.pct}`}
                    strokeDashoffset={a.offset}
                    strokeLinecap="butt"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex rotate-0 flex-col items-center justify-center">
                <span className="text-[13px] font-extrabold leading-none text-gray-50">
                  {Number(timeSaved.hoursSaved || 0).toLocaleString()}
                </span>
                <span className="text-[8px] uppercase text-gray-500">hrs</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-lg font-extrabold leading-tight text-gray-50">
                {Number(timeSaved.hoursSaved || 0).toLocaleString()} hrs
              </div>
              <div className="text-[10.5px] text-gray-500">
                Saved this {timeSaved.period}
                <span className="ml-1 rounded bg-gray-800 px-1 py-px text-[9px] uppercase tracking-wide text-gray-400">estimate</span>
              </div>
            </div>
          </div>
          {breakdown.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {breakdown.slice(0, 3).map((b, i) => (
                <li key={i} className="flex items-center justify-between text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="truncate text-gray-400">{b.task}</span>
                  </span>
                  <span className="ml-2 shrink-0 font-semibold text-gray-200">{b.hours} h</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

export function OpportunitiesPanel({ items, onNavigate }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <Panel title="Top Opportunities" accent="#38bdf8">
      {list.length === 0 ? (
        <div className="py-2 text-[12px] text-gray-500">No open opportunities right now.</div>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 5).map((o) => (
            <li key={o.key}>
              <button
                onClick={() => o.section && onNavigate && onNavigate(o.section)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="truncate text-[12px] text-gray-300 hover:text-gray-100">{o.label}</span>
                <span className="shrink-0 rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-bold text-sky-300">
                  {o.value}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function InsightsPanel({ insights, onNavigate, onUpgrade }) {
  const ins = insights || { locked: true, items: [] };
  return (
    <Panel title="Executive Insights" accent="#fcd34d">
      {ins.locked ? (
        <div className="py-1">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-300">
            <svg className="h-3.5 w-3.5 text-amber-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Enterprise feature
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-gray-500">
            Sage's weekly strategy insights for your industry — unlocked on the Enterprise plan.
          </p>
          <button
            onClick={onUpgrade}
            className="mt-2.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/20"
          >
            View Enterprise plan
          </button>
        </div>
      ) : ins.items.length === 0 ? (
        <div className="py-2 text-[12px] leading-snug text-gray-500">
          Sage's first weekly strategy profile hasn't been generated yet — insights appear after the next research cycle.
        </div>
      ) : (
        <ul className="space-y-2">
          {ins.items.slice(0, 3).map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
              <span className="min-w-0 text-[12px] leading-snug text-gray-300">
                {typeof it === "string" ? it : it.title || it.insight || it.summary || ""}
              </span>
            </li>
          ))}
          <li>
            <button onClick={() => onNavigate && onNavigate("sage")} className="text-[11px] font-semibold text-amber-300 hover:text-amber-200">
              View all insights →
            </button>
          </li>
        </ul>
      )}
    </Panel>
  );
}

export function UpcomingPanel({ items }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <Panel title="Coming Up" accent="#7dd3fc">
      {list.length === 0 ? (
        <div className="py-2 text-[12px] text-gray-500">Nothing scheduled yet — scheduled posts and appointments appear here.</div>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 6).map((u, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: u.type === "appointment" ? "#f97316" : "#ec4899" }}
                />
                <span className="truncate text-gray-300">{u.label}</span>
              </span>
              <span className="shrink-0 text-[11px] text-gray-500">
                {u.when
                  ? new Date(u.when).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function GeoPanel({ geoCoverage }) {
  const g = geoCoverage;
  return (
    <Panel title="Geo Coverage" accent="#5eead4">
      {!g || !g.configured ? (
        <div className="py-2 text-[12px] text-gray-500">
          No geographic targeting configured — campaigns run without location limits.
        </div>
      ) : (
        <>
          <div className="text-[12px] leading-snug text-gray-300">{g.summary || "Targeting configured"}</div>
          <div className="mt-2 flex gap-3 text-[11px] text-gray-500">
            <span>
              <span className="font-semibold text-teal-300">{g.areaCount}</span> targeted
            </span>
            <span>
              <span className="font-semibold text-rose-300">{g.exclusionCount}</span> excluded
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

export function StatusBar({ systemStatus, now }) {
  const st = systemStatus || {};
  const healthy = st.health === "healthy";
  const label =
    st.health === "healthy"
      ? "All Systems Operational"
      : st.health === "unknown"
        ? "Awaiting first health check"
        : `Health: ${st.health}`;
  const d = now || new Date();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-cyan-950/60 bg-[#04070f] px-5 py-3 text-[11px] text-gray-400">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-lg font-extrabold leading-none text-cyan-500/70" aria-hidden="true">
          &ldquo;
        </span>
        <span className="truncate italic text-gray-500">
          While you were away, your AI company never stopped building.
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: healthy ? "#34d399" : st.health === "unknown" ? "#64748b" : "#f59e0b",
              boxShadow: healthy ? "0 0 6px #34d399" : "none",
            }}
          />
          <span>
            <span className="block font-semibold text-gray-300">System Status</span>
            <span className="block text-[10px] text-gray-500">
              {label}
              {st.lastHealthCheck ? ` · checked ${relTime(st.lastHealthCheck)}` : ""}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-cyan-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <span>
            <span className="block font-semibold text-gray-300">Data Secure</span>
            <span className="block text-[10px] text-gray-500">AES-256 Encryption</span>
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold text-gray-300">
            {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="block text-[10px] text-gray-500">
            {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </span>
        </span>
      </span>
    </div>
  );
}
