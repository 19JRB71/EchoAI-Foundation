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
export function KpiTile({ label, value, deltaPct, deltaLabel, accent = "#22d3ee" }) {
  const up = deltaPct != null && deltaPct > 0;
  const down = deltaPct != null && deltaPct < 0;
  return (
    <div className="rounded-2xl border border-cyan-950/70 bg-[#050b1d]/90 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-gray-50" style={{ textShadow: `0 0 18px ${accent}33` }}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px]">
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
export function ActivityFeed({ items }) {
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
    { label: "Posts Published", value: g.postsPublished },
    { label: "New Leads", value: g.newLeads },
    { label: "Calls Answered", value: g.callsAnswered },
    { label: "Appointments", value: g.appointmentsBooked },
    { label: "Issues Resolved", value: g.issuesResolved },
    { label: "Reviews Responded", value: g.reviewsResponded },
  ];
  return (
    <Panel title="Today at a Glance" accent="#fbbf24">
      {glance == null ? (
        <div className="py-2 text-[12px] text-gray-500">Add a business to see today's numbers.</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline gap-2">
              <span className="text-lg font-extrabold text-gray-100">{r.value ?? 0}</span>
              <span className="text-[10px] leading-tight text-gray-500">{r.label}</span>
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
            <div className="mt-3 flex h-14 items-end gap-1.5">
              {trend.map((t, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-emerald-400/70"
                  style={{ height: `${Math.max(6, (t.revenue / maxRev) * 100)}%` }}
                  title={`$${Number(t.revenue).toLocaleString()}`}
                />
              ))}
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

export function TimePanel({ timeSaved }) {
  return (
    <Panel title="Time Automated" accent="#a78bfa">
      {timeSaved == null ? (
        <div className="py-2 text-[12px] leading-snug text-gray-500">
          Hours saved appear once your AI team has completed real work.
        </div>
      ) : (
        <>
          <div className="text-2xl font-extrabold text-gray-50">
            {Number(timeSaved.hoursSaved || 0).toLocaleString()} hrs
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">
            Saved this {timeSaved.period}
            <span className="ml-1 rounded bg-gray-800 px-1 py-px text-[9px] uppercase tracking-wide text-gray-400">estimate</span>
          </div>
          {Array.isArray(timeSaved.breakdown) && timeSaved.breakdown.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {timeSaved.breakdown.slice(0, 3).map((b, i) => (
                <li key={i} className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-gray-400">{b.task}</span>
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

export function StatusBar({ systemStatus }) {
  const st = systemStatus || {};
  const healthy = st.health === "healthy";
  const label =
    st.health === "healthy"
      ? "All Systems Operational"
      : st.health === "unknown"
        ? "Awaiting first health check"
        : `Health: ${st.health}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-950/70 bg-[#050b1d]/90 px-4 py-2.5 text-[11px] text-gray-400">
      <span className="flex items-center gap-2">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: healthy ? "#34d399" : st.health === "unknown" ? "#64748b" : "#f59e0b" }}
        />
        {label}
        {st.lastHealthCheck ? <span className="text-gray-600">· checked {relTime(st.lastHealthCheck)}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <svg className="h-3 w-3 text-cyan-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        Data Secure · AES-256 encryption
      </span>
      <span className="text-gray-500">
        {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      </span>
    </div>
  );
}
