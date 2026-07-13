import { AGENTS_META } from "../lib/departments.js";

// Mission Control V2 — left "Executive Command Panel". The nine-agent roster
// lives in the Zorecho Core visualization (the official view of the AI
// workforce), so the sidebar earns its space differently: Echo (the owner's
// assistant), a live AI-workforce summary from REAL platform data, the
// business switcher, quick actions, and the Zorecho brand card.

const STATUS_COLOR = {
  active: "#22c55e",
  working: "#f59e0b",
  attention: "#ef4444",
};
const STATUS_LABEL = {
  active: "Active",
  working: "Working",
  attention: "Needs you",
};

function SectionLabel({ children }) {
  return (
    <div className="px-3 pb-1.5 pt-3.5 text-[9.5px] font-bold uppercase tracking-[0.22em] text-cyan-400">
      {children}
    </div>
  );
}

// Honest numeric rendering — "—" when the value is absent, never a fake 0.
// Number(null) === 0, so null/undefined/"" must be caught BEFORE coercion.
function num(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : "—";
}

function SummaryRow({ label, value, accent = "#22d3ee" }) {
  return (
    <div className="flex items-center justify-between px-3 py-[5px]">
      <span className="text-[10.5px] text-gray-500">{label}</span>
      <span className="text-[11.5px] font-bold text-gray-100" style={{ textShadow: `0 0 12px ${accent}33` }}>
        {value}
      </span>
    </div>
  );
}

const ACTION_ICONS = {
  mic: "M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z",
  rocket: "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
  plus: "M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z",
  chart: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  gear: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
};

function QuickAction({ icon, label, onClick, testId }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="flex items-center gap-2 rounded-lg border border-cyan-950/70 bg-[#070d1c]/90 px-2.5 py-2 text-left text-[11px] font-semibold text-gray-200 transition-colors hover:border-cyan-700/50 hover:text-cyan-200"
    >
      <svg className="h-3.5 w-3.5 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={ACTION_ICONS[icon]} />
      </svg>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function ExecutiveSidebar({
  data,
  brands,
  selectedBrandId,
  onSelectBrand,
  onNavigate,
  onTalkToEcho,
}) {
  const roster = Array.isArray(data?.agents) ? data.agents : [];
  const echo = roster.find((a) => a.id === "echo") || null;
  const echoMeta = AGENTS_META.find((m) => m.id === "echo") || {};
  const echoColor = echoMeta.color || "#14B8A6";
  const echoStatus = echo ? STATUS_COLOR[echo.status] || "#f59e0b" : "#6b7280";

  const activeAgents = roster.filter((a) => a.status === "active" || a.status === "working").length;
  const kpis = Object.fromEntries((Array.isArray(data?.kpis) ? data.kpis : []).map((k) => [k.key, k]));
  const health = data?.systemStatus?.health;
  const healthLabel =
    health === "healthy" ? "Operational" : health && health !== "unknown" ? health : "No sweep yet";
  const healthColor = health === "healthy" ? "#34d399" : health && health !== "unknown" ? "#f59e0b" : "#6b7280";

  const brandList = Array.isArray(brands) ? brands.filter((b) => !b.is_demo) : [];

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-cyan-950/60 bg-[#04070f]">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* Echo — the owner's assistant, always available */}
        <SectionLabel>Echo Assistant</SectionLabel>
        <div className="px-2.5">
          <button
            onClick={onTalkToEcho}
            data-testid="sidebar-echo"
            className="group w-full rounded-xl border border-cyan-950/70 bg-[#070d1c]/90 px-2.5 py-2.5 text-left transition-colors hover:border-cyan-700/50"
          >
            <span className="flex items-start gap-2.5">
              <span
                className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[14px] font-bold"
                style={{ backgroundColor: `${echoColor}1f`, color: echoColor, border: `1px solid ${echoColor}55` }}
              >
                E
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-[#04070f]"
                  style={{ backgroundColor: echoStatus, boxShadow: `0 0 6px ${echoStatus}` }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-1.5">
                  <span className="text-[13px] font-semibold text-gray-100">Echo</span>
                  <svg className="h-3.5 w-3.5 shrink-0 text-cyan-400/80 group-hover:text-cyan-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={ACTION_ICONS.mic} />
                  </svg>
                </span>
                <span className="block text-[10px] text-gray-500">
                  {echo ? STATUS_LABEL[echo.status] || "Working" : "Your assistant"}
                </span>
                {echo && echo.currentTask && (
                  <span className="mt-0.5 block truncate text-[10px] italic text-gray-600 group-hover:text-gray-500">
                    {echo.currentTask}
                  </span>
                )}
              </span>
            </span>
          </button>
        </div>

        {/* Live company summary — real platform data only */}
        <SectionLabel>AI Workforce</SectionLabel>
        <div className="mx-2.5 rounded-xl border border-cyan-950/70 bg-[#070d1c]/90 py-1" data-testid="workforce-summary">
          <SummaryRow label="Agents Active" value={roster.length ? `${activeAgents}/${roster.length}` : "—"} />
          <SummaryRow label="Tasks Done Today" value={num(kpis.tasksCompleted?.today)} accent="#34d399" />
          <SummaryRow label="Campaigns Running" value={num(data?.workforce?.campaignsRunning)} accent="#f97316" />
          <SummaryRow label="Conversations Active" value={num(data?.workforce?.conversationsActive)} accent="#a78bfa" />
          <div className="flex items-center justify-between px-3 py-[5px]">
            <span className="text-[10.5px] text-gray-500">System Health</span>
            <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: healthColor }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: healthColor, boxShadow: `0 0 6px ${healthColor}` }} />
              {healthLabel}
            </span>
          </div>
        </div>

        {/* Business switcher */}
        {brandList.length > 0 && (
          <>
            <SectionLabel>Businesses</SectionLabel>
            <div className="space-y-1 px-2.5">
              {brandList.map((b) => {
                const isActive = String(b.brand_id) === String(selectedBrandId);
                return (
                  <button
                    key={b.brand_id}
                    onClick={() => onSelectBrand && onSelectBrand(b.brand_id)}
                    data-testid={`sidebar-brand-${b.brand_id}`}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                      isActive
                        ? "border-cyan-600/60 bg-cyan-950/40 font-semibold text-cyan-100"
                        : "border-cyan-950/70 bg-[#070d1c]/60 text-gray-400 hover:border-cyan-800/50 hover:text-gray-200"
                    }`}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={
                        isActive
                          ? { backgroundColor: "#22d3ee", boxShadow: "0 0 6px #22d3ee" }
                          : { backgroundColor: "#374151" }
                      }
                    />
                    <span className="truncate">{b.brand_name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Quick actions */}
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="grid grid-cols-1 gap-1 px-2.5">
          <QuickAction icon="mic" label="Talk to Echo" onClick={onTalkToEcho} testId="qa-talk-echo" />
          <QuickAction icon="rocket" label="Create Campaign" onClick={() => onNavigate && onNavigate("campaigns")} testId="qa-campaign" />
          <QuickAction icon="plus" label="New Task" onClick={() => onNavigate && onNavigate("echoplanner")} testId="qa-task" />
          <QuickAction icon="chart" label="Reports" onClick={() => onNavigate && onNavigate("roi")} testId="qa-reports" />
          <QuickAction icon="gear" label="Settings" onClick={() => onNavigate && onNavigate("settings")} testId="qa-settings" />
        </div>
      </div>

      {/* Premium Zorecho brand card */}
      <div className="border-t border-cyan-950/60 px-3 py-3.5">
        <div className="relative overflow-hidden rounded-xl border border-cyan-950/70 bg-gradient-to-b from-[#071026] to-[#04070f] px-3 py-3">
          <div
            className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(34,211,238,0.18), transparent 70%)" }}
            aria-hidden="true"
          />
          <div className="text-sm font-extrabold tracking-[0.18em] text-gray-100">ZORECHO</div>
          <div className="mt-1 text-[10px] leading-snug text-gray-500">
            Your AI Company
            <br />
            Never Stops.
          </div>
        </div>
      </div>
    </aside>
  );
}
