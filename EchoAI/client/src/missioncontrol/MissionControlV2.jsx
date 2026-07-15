import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";
import CoreHero from "./CoreHero.jsx";
import SetupChecklistCard from "./SetupChecklistCard.jsx";
import ExecutiveSidebar from "./ExecutiveSidebar.jsx";
import {
  KpiTile,
  ZorechoScoreCard,
  ActivityFeed,
  AttentionPanel,
  GlancePanel,
  RevenuePanel,
  TimePanel,
  OpportunitiesPanel,
  InsightsPanel,
  UpcomingPanel,
  GeoPanel,
  StatusBar,
} from "./panels.jsx";

// Mission Control V2 — the redesigned Headquarters screen, built to match the
// approved concept image: a full-screen command center with its own AI
// Executive Team sidebar, top bar, glowing Zorecho Core, right rail and quote
// footer. Every number is real data from /api/agents/mission-control/v2 —
// panels without data render honest reserved/empty states, never fabrications.

const PART_LABEL = {
  morning: "Good Morning",
  afternoon: "Good Afternoon",
  evening: "Good Evening",
  late: "Working late",
};

// Honest reserved state: when a KPI is absent from the payload (e.g. no
// business yet), show "—", never a fabricated zero.
function kpiValue(k) {
  const n = Number(k?.today);
  return Number.isFinite(n) ? n.toLocaleString() : "—";
}
function kpiDeltaLabel(k) {
  return k ? undefined : "no data yet";
}

export default function MissionControlV2({
  brandId,
  brands,
  onSelectBrand,
  onNavigate,
  onOpenDepartment,
  onUpgrade,
  onLogout,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  // Mobile-only nav drawer (< lg): the fixed full-screen layout covers the
  // app shell, so on small screens the Executive sidebar opens as a slide-over
  // (same component, same actions). Invisible on lg+ where the sidebar is
  // docked — the approved desktop layout is unchanged.
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const navigateAndClose = useCallback(
    (...args) => {
      setNavOpen(false);
      if (onNavigate) onNavigate(...args);
    },
    [onNavigate],
  );
  const selectBrandAndClose = useCallback(
    (id) => {
      setNavOpen(false);
      if (onSelectBrand) onSelectBrand(id);
    },
    [onSelectBrand],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await api.getMissionControlV2(brandId);
      setData(d);
    } catch (e) {
      setError(e.message || "Failed to load Mission Control.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Calm live refresh — one quiet re-pull per minute, no spinner (the screen
  // never flashes; new numbers just settle in). The clock ticks alongside it.
  useEffect(() => {
    const t = setInterval(load, 60000);
    const clock = setInterval(() => setNow(new Date()), 30000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [load]);

  const attentionCount = data ? (data.attention || []).length : 0;
  const talkToEcho = () => window.dispatchEvent(new CustomEvent("echoai:open-companion"));

  // One-time "powering on" moment — when AI Company Activation first reaches
  // 100%, Mission Control quietly comes alive: the Core brightens, connection
  // lines pulse, and the dashboard settles in. Subtle by design (NASA, not a
  // video game), guarded by localStorage so it plays exactly once per browser.
  const [poweringOn, setPoweringOn] = useState(false);
  const handleChecklistStatus = useCallback((checklist) => {
    if (!checklist?.allDone) return;
    try {
      if (localStorage.getItem("echoai_activation_poweron") === "1") return;
      localStorage.setItem("echoai_activation_poweron", "1");
    } catch {
      return;
    }
    setPoweringOn(true);
    setTimeout(() => setPoweringOn(false), 6000);
  }, []);

  let body;
  if (loading) {
    body = (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner />
      </div>
    );
  } else if (error) {
    body = (
      <div className="m-6 rounded-2xl border border-rose-900/60 bg-rose-950/30 p-6 text-sm text-rose-200">
        {error}
        <button onClick={() => { setLoading(true); load(); }} className="ml-3 font-semibold underline">
          Retry
        </button>
      </div>
    );
  } else if (data) {
    const kpis = Object.fromEntries((data.kpis || []).map((k) => [k.key, k]));
    const greeting = PART_LABEL[data.partOfDay] || "Hello";
    const dateLine = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const timeLine = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    body = (
      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:flex">
          <ExecutiveSidebar
            data={data}
            brands={brands}
            selectedBrandId={brandId}
            onSelectBrand={onSelectBrand}
            onNavigate={onNavigate}
            onTalkToEcho={talkToEcho}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-4 sm:p-5">
            {/* Greeting */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-gray-50">
                  {greeting}
                  {data.ownerName ? (
                    <>
                      , <span className="text-cyan-300">{data.ownerName}</span>.
                    </>
                  ) : (
                    "."
                  )}
                </h1>
                <div className="mt-1 text-[12px] text-gray-500">
                  {dateLine} <span className="mx-1 text-gray-700">•</span> {timeLine}
                </div>
                <div className="mt-1.5 text-[13px] font-medium italic text-gray-300">
                  Your AI Company Never Stopped Working.
                </div>
              </div>
              {data.brandName && (
                <div className="rounded-xl border border-cyan-950/70 bg-[#050b1d]/90 px-3 py-2 text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Business</div>
                  <div className="text-sm font-semibold text-gray-200">{data.brandName}</div>
                </div>
              )}
            </div>

            {/* Echo's briefing line */}
            {data.briefing && (
              <div className="rounded-2xl border border-cyan-950/70 bg-[#050b1d]/90 px-4 py-3 text-[13px] leading-relaxed text-gray-300">
                <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-300">Echo</span>
                {data.briefing}
              </div>
            )}

            {/* Main grid: center column + right rail */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-4">
                {/* KPI strip */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
                  <KpiTile icon="check" label="Tasks Completed" value={kpiValue(kpis.tasksCompleted)} deltaPct={kpis.tasksCompleted?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.tasksCompleted)} />
                  <KpiTile icon="calendar" label="Appointments Booked" value={kpiValue(kpis.appointmentsBooked)} deltaPct={kpis.appointmentsBooked?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.appointmentsBooked)} accent="#f97316" />
                  <KpiTile icon="phone" label="Calls Answered" value={kpiValue(kpis.callsAnswered)} deltaPct={kpis.callsAnswered?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.callsAnswered)} accent="#a78bfa" />
                  <KpiTile icon="users" label="Leads Followed Up" value={kpiValue(kpis.leadsFollowedUp)} deltaPct={kpis.leadsFollowedUp?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.leadsFollowedUp)} accent="#0ea5e9" />
                  <KpiTile
                    icon="dollar"
                    label="Revenue Impact"
                    value={Number.isFinite(Number(data.revenueImpact?.totalValueGenerated)) ? `$${Number(data.revenueImpact.totalValueGenerated).toLocaleString()}` : "—"}
                    deltaPct={null}
                    deltaLabel={data.revenueImpact ? "estimated this month" : "builds with activity"}
                    accent="#34d399"
                  />
                  <KpiTile
                    icon="clock"
                    label="Time Saved"
                    value={Number.isFinite(Number(data.timeSaved?.hoursSaved)) ? `${Number(data.timeSaved.hoursSaved).toLocaleString()} hrs` : "—"}
                    deltaPct={null}
                    deltaLabel={data.timeSaved ? "estimated this month" : "builds with activity"}
                    accent="#a78bfa"
                  />
                </div>

                <CoreHero
                  agents={data.agents}
                  onOpenDepartment={onOpenDepartment}
                  healthy={attentionCount === 0}
                  statusLine={
                    attentionCount === 0
                      ? "AI Company Operating at Full Capacity"
                      : `${attentionCount} item${attentionCount === 1 ? "" : "s"} need your attention`
                  }
                />

                {/* Bottom row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <GlancePanel glance={data.todayAtAGlance} />
                  <RevenuePanel revenueImpact={data.revenueImpact} revenueTrend={data.revenueTrend} />
                  <TimePanel timeSaved={data.timeSaved} />
                  <OpportunitiesPanel items={data.opportunities} onNavigate={onNavigate} />
                </div>

                {/* Legacy Mission Control data, reorganized in (nothing lost) */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <UpcomingPanel items={data.upcoming} />
                  </div>
                  <GeoPanel geoCoverage={data.geoCoverage} />
                </div>
              </div>

              {/* Right rail */}
              <div className="min-w-0 space-y-4">
                <SetupChecklistCard onNavigate={onNavigate} onStatus={handleChecklistStatus} />
                <ZorechoScoreCard score={data.zorechoScore} />
                <ActivityFeed items={data.activityFeed} onViewAll={onNavigate ? () => onNavigate("aiteam") : undefined} />
                <AttentionPanel items={data.attention} onNavigate={onNavigate} />
                <InsightsPanel insights={data.insights} onNavigate={onNavigate} onUpgrade={onUpgrade} />
              </div>
            </div>
          </div>

          <StatusBar systemStatus={data.systemStatus} now={now} />
        </div>
      </div>
    );
  } else {
    body = null;
  }

  return (
    <div
      className={`mcv2 fixed inset-0 z-[70] flex flex-col bg-[#02040b]${poweringOn ? " mcv2-poweron" : ""}`}
      data-testid="mission-control-v2"
    >
      <style>{`
        .mcv2 .mcv2-core-bar { animation: mcv2bar 2.6s ease-in-out infinite; transform-origin: bottom; transition: filter .7s ease; }
        .mcv2 .mcv2-core { animation: mcv2breathe 3.5s ease-in-out infinite; transition: filter .7s ease; }
        .mcv2 .mcv2-core-ring { animation: mcv2ringbreathe 7s ease-in-out infinite; transition: transform .6s ease; }
        .mcv2 .mcv2-core-ring-slow { animation: mcv2ring 6s ease-in-out 1.2s infinite; }
        .mcv2 .mcv2-orbit { animation: mcv2orbit 3.2s linear infinite; }
        /* Listening — the outer ring expands slightly, waveform gets more active,
           and the sidebar mic glows (handled in ExecutiveSidebar). */
        .mcv2 .mcv2-listening .mcv2-core-ring { animation: mcv2ringlisten 2.4s ease-in-out infinite; }
        .mcv2 .mcv2-listening .mcv2-core-bar { animation-duration: 1.4s; }
        /* Thinking — the waveform rests while the particles orbit */
        .mcv2 .mcv2-thinking .mcv2-core-bar { animation-play-state: paused; opacity: .45; }
        /* Speaking — the whole core comes alive: faster/fuller waveform, brighter
           glow, pulsing rings. The .7s filter transitions above let everything
           settle back down smoothly when Echo stops. */
        .mcv2 .mcv2-speaking .mcv2-core-bar { animation: mcv2barspeak .8s ease-in-out infinite; filter: brightness(1.3) drop-shadow(0 0 6px rgba(103,232,249,0.7)); }
        .mcv2 .mcv2-speaking .mcv2-core { animation-duration: 1.8s; filter: brightness(1.35); }
        .mcv2 .mcv2-speaking .mcv2-core-ring { animation: mcv2ringspeak 1.6s ease-in-out infinite; }
        .mcv2 .mcv2-speaking .mcv2-core-ring-slow { animation: mcv2ringspeak 1.6s ease-in-out .4s infinite; }
        .mcv2 .mcv2-speaking .mcv2-line { animation: mcv2linespeak 1.6s ease-in-out infinite; }
        .mcv2 .mcv2-core-emit { animation: mcv2emit 1.8s ease-out infinite; opacity: 0; }
        /* Power-on — one-shot when activation first hits 100%. Everything fades
           in smoothly, the Core illuminates with a soft glow, and the
           connection lines animate a little brighter. Subtle, then settles. */
        .mcv2.mcv2-poweron { animation: mcv2poweronfade 1.6s ease-out; }
        .mcv2.mcv2-poweron .mcv2-core { animation: mcv2poweroncore 3.2s ease-in-out; }
        .mcv2.mcv2-poweron .mcv2-core-ring { animation: mcv2poweronring 3.2s ease-in-out; }
        .mcv2.mcv2-poweron .mcv2-line { animation: mcv2linespeak 1.6s ease-in-out 2; }
        @keyframes mcv2bar { 0%,100% { transform: scaleY(0.55); opacity:.7 } 50% { transform: scaleY(1); opacity:1 } }
        @keyframes mcv2ring { 0%,100% { opacity:.5 } 50% { opacity:.9 } }
        @keyframes mcv2ringlisten { 0%,100% { opacity:.75; transform: scale(1.05) } 50% { opacity:1; transform: scale(1.09) } }
        @keyframes mcv2breathe { 0%,100% { opacity:.82; transform: scale(1) } 50% { opacity:1; transform: scale(1.025) } }
        @keyframes mcv2ringbreathe { 0%,100% { opacity:.5; transform: scale(1) } 50% { opacity:.85; transform: scale(1.015) } }
        @keyframes mcv2ringbright { 0%,100% { opacity:.7 } 50% { opacity:1 } }
        @keyframes mcv2barspeak { 0%,100% { transform: scaleY(0.35); opacity:.75 } 50% { transform: scaleY(1.12); opacity:1 } }
        @keyframes mcv2ringspeak { 0%,100% { opacity:.7; transform: scale(1) } 50% { opacity:1; transform: scale(1.03) } }
        @keyframes mcv2linespeak { 0%,100% { opacity:.55; stroke-width:.35 } 50% { opacity:1; stroke-width:.55 } }
        @keyframes mcv2emit { 0% { opacity:.55; transform: scale(.92) } 100% { opacity:0; transform: scale(1.25) } }
        @keyframes mcv2orbit { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes mcv2poweronfade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mcv2poweroncore { 0% { filter: brightness(.7) } 40% { filter: brightness(1.45) } 100% { filter: brightness(1) } }
        @keyframes mcv2poweronring { 0% { opacity:.3 } 40% { opacity:1 } 100% { opacity:.6 } }
        @media (prefers-reduced-motion: reduce) {
          .mcv2 .mcv2-core-bar, .mcv2 .mcv2-core, .mcv2 .mcv2-core-ring, .mcv2 .mcv2-core-ring-slow, .mcv2 .mcv2-orbit,
          .mcv2 .mcv2-speaking .mcv2-core-bar, .mcv2 .mcv2-speaking .mcv2-core, .mcv2 .mcv2-speaking .mcv2-core-ring, .mcv2 .mcv2-speaking .mcv2-core-ring-slow,
          .mcv2 .mcv2-speaking .mcv2-line, .mcv2 .mcv2-core-emit,
          .mcv2 .mcv2-listening .mcv2-core-ring, .mcv2 .mcv2-listening .mcv2-core-bar { animation: none; }
          .mcv2.mcv2-poweron, .mcv2.mcv2-poweron .mcv2-core, .mcv2.mcv2-poweron .mcv2-core-ring, .mcv2.mcv2-poweron .mcv2-line { animation: none; }
          .mcv2 .mcv2-line-pulse, .mcv2 .mcv2-core-emit { display: none; }
        }
      `}</style>

      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-950/60 bg-[#04070f] px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setNavOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-950/70 bg-[#070d1c]/90 text-gray-300 hover:border-cyan-700/50 hover:text-cyan-200 lg:hidden"
            aria-label="Open menu"
            data-testid="mcv2-menu-button"
          >
            <svg className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div>
            <div className="text-[13px] font-extrabold uppercase tracking-[0.3em] text-gray-100">
              Mission <span className="text-cyan-400">Control</span>
            </div>
            <div className="text-[10px] text-gray-500">Headquarters of Your AI Company</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="relative" title={`${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`}>
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            {attentionCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {attentionCount}
              </span>
            )}
          </span>
          {data && data.ownerName && (
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-700/50 bg-cyan-900/40 text-[11px] font-bold text-cyan-200">
                {data.ownerName[0]}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-[11px] font-semibold leading-tight text-gray-200">{data.ownerName}</span>
                <span className="block text-[9px] leading-tight text-gray-500">Owner</span>
              </span>
            </span>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              data-testid="mcv2-logout"
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors"
              style={{
                borderColor: "#39ff14aa",
                backgroundColor: "rgba(57,255,20,0.10)",
                color: "#39ff14",
                textShadow: "0 0 8px rgba(57,255,20,0.55)",
                boxShadow: "0 0 12px rgba(57,255,20,0.35), inset 0 0 8px rgba(57,255,20,0.12)",
              }}
              title="Log out"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              <span className="hidden sm:inline">Log out</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav drawer (< lg) — same ExecutiveSidebar, as a slide-over. */}
      {navOpen && (
        <div className="fixed inset-0 z-[80] flex lg:hidden" data-testid="mcv2-mobile-nav">
          <div className="flex max-w-[80vw]">
            <ExecutiveSidebar
              data={data}
              brands={brands}
              selectedBrandId={brandId}
              onSelectBrand={selectBrandAndClose}
              onNavigate={navigateAndClose}
              onTalkToEcho={() => {
                setNavOpen(false);
                talkToEcho();
              }}
            />
          </div>
          <button
            className="flex-1 bg-black/60"
            onClick={closeNav}
            aria-label="Close menu"
          />
        </div>
      )}

      {body}
    </div>
  );
}
