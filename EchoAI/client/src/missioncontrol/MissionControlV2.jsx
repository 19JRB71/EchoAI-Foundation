import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";
import CoreHero from "./CoreHero.jsx";
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

// Mission Control V2 — the redesigned Headquarters screen, built from the
// approved concept. Chassis stage: full layout with every panel wired to the
// real /api/agents/mission-control/v2 aggregation. Everything shown is real
// data — panels without data render honest reserved/empty states.

const PART_LABEL = {
  morning: "Good Morning",
  afternoon: "Good Afternoon",
  evening: "Good Evening",
  late: "Working late",
};

// Honest reserved state: when a KPI is absent from the payload (e.g. no
// business yet), show "—", never a fabricated zero.
function kpiValue(k) {
  return k ? Number(k.today).toLocaleString() : "—";
}
function kpiDeltaLabel(k) {
  return k ? undefined : "no data yet";
}

export default function MissionControlV2({ brandId, onNavigate, onOpenDepartment, onUpgrade }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  // never flashes; new numbers just settle in).
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-900/60 bg-rose-950/30 p-6 text-sm text-rose-200">
        {error}
        <button onClick={() => { setLoading(true); load(); }} className="ml-3 font-semibold underline">
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  const kpis = Object.fromEntries((data.kpis || []).map((k) => [k.key, k]));
  const greeting = PART_LABEL[data.partOfDay] || "Hello";
  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const attentionCount = (data.attention || []).length;
  const talkToEcho = () => window.dispatchEvent(new CustomEvent("echoai:open-companion"));

  return (
    <div className="mcv2 -m-1 space-y-4 rounded-3xl bg-[#02040b] p-4 sm:p-5" data-testid="mission-control-v2">
      <style>{`
        .mcv2 .mcv2-core-bar { animation: mcv2bar 2.6s ease-in-out infinite; transform-origin: bottom; }
        .mcv2 .mcv2-core { animation: mcv2glow 4s ease-in-out infinite; }
        .mcv2 .mcv2-core-ring { animation: mcv2ring 6s ease-in-out infinite; }
        .mcv2 .mcv2-core-ring-slow { animation: mcv2ring 6s ease-in-out 1.2s infinite; }
        @keyframes mcv2bar { 0%,100% { transform: scaleY(0.55); opacity:.7 } 50% { transform: scaleY(1); opacity:1 } }
        @keyframes mcv2glow { 0%,100% { opacity:.85 } 50% { opacity:1 } }
        @keyframes mcv2ring { 0%,100% { opacity:.5 } 50% { opacity:.9 } }
        @media (prefers-reduced-motion: reduce) {
          .mcv2 .mcv2-core-bar, .mcv2 .mcv2-core, .mcv2 .mcv2-core-ring, .mcv2 .mcv2-core-ring-slow { animation: none; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400">Mission Control</div>
          <div className="text-[11px] text-gray-500">Headquarters of Your AI Company</div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-gray-50">
            {greeting}
            {data.ownerName ? (
              <>
                , <span className="text-cyan-300">{data.ownerName}</span>.
              </>
            ) : (
              "."
            )}
          </h1>
          <div className="mt-1 text-[12px] text-gray-500">{dateLine}</div>
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Tasks Completed" value={kpiValue(kpis.tasksCompleted)} deltaPct={kpis.tasksCompleted?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.tasksCompleted)} />
        <KpiTile label="Appointments Booked" value={kpiValue(kpis.appointmentsBooked)} deltaPct={kpis.appointmentsBooked?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.appointmentsBooked)} />
        <KpiTile label="Calls Answered" value={kpiValue(kpis.callsAnswered)} deltaPct={kpis.callsAnswered?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.callsAnswered)} />
        <KpiTile label="Leads Followed Up" value={kpiValue(kpis.leadsFollowedUp)} deltaPct={kpis.leadsFollowedUp?.deltaPct} deltaLabel={kpiDeltaLabel(kpis.leadsFollowedUp)} />
        <KpiTile
          label="Revenue Impact"
          value={data.revenueImpact ? `$${Number(data.revenueImpact.totalValueGenerated || 0).toLocaleString()}` : "—"}
          deltaPct={null}
          deltaLabel={data.revenueImpact ? "estimated this month" : "builds with activity"}
          accent="#34d399"
        />
        <KpiTile
          label="Time Saved"
          value={data.timeSaved ? `${Number(data.timeSaved.hoursSaved || 0).toLocaleString()} hrs` : "—"}
          deltaPct={null}
          deltaLabel={data.timeSaved ? "estimated this month" : "builds with activity"}
          accent="#a78bfa"
        />
      </div>

      {/* Core + right column */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CoreHero
            agents={data.agents}
            onOpenDepartment={onOpenDepartment}
            onTalkToEcho={talkToEcho}
            statusLine={
              attentionCount === 0
                ? "AI Company Operating at Full Capacity"
                : `${attentionCount} item${attentionCount === 1 ? "" : "s"} need your attention`
            }
          />
        </div>
        <div className="space-y-4">
          <ZorechoScoreCard score={data.zorechoScore} />
          <ActivityFeed items={data.activityFeed} />
          <AttentionPanel items={data.attention} onNavigate={onNavigate} />
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <GlancePanel glance={data.todayAtAGlance} />
        <RevenuePanel revenueImpact={data.revenueImpact} revenueTrend={data.revenueTrend} />
        <TimePanel timeSaved={data.timeSaved} />
        <OpportunitiesPanel items={data.opportunities} onNavigate={onNavigate} />
        <InsightsPanel
          insights={data.insights}
          onNavigate={onNavigate}
          onUpgrade={onUpgrade}
        />
      </div>

      {/* Legacy Mission Control data, reorganized in (nothing lost) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <UpcomingPanel items={data.upcoming} />
        </div>
        <GeoPanel geoCoverage={data.geoCoverage} />
      </div>

      <StatusBar systemStatus={data.systemStatus} />
    </div>
  );
}
