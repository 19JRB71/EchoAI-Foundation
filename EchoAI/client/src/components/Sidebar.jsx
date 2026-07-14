import { useState, useEffect } from "react";
import { api } from "../api";
import { useBranding } from "../lib/BrandingContext.jsx";
import { isDefaultBrand as isDefaultBranding } from "../lib/branding.js";
import { tierForSection } from "../lib/tiers.js";
import { AGENTS_META } from "../lib/departments.js";
import MusicWidget from "./MusicWidget.jsx";

// The dashboard is organized around the eight AI team members. This sidebar is
// intentionally minimal: Mission Control at the top, the team roster (each with a
// colored avatar + live status dot) in the middle, and Settings / Admin / Log out
// at the bottom. Clicking a team member opens that member's Department View.

// The accent tier ('starter'|'pro'|'enterprise') for a section — re-exported from
// the shared tier catalog so App.jsx (which tints the main content area) shares one
// source of truth.
export function accentTierForSection(sectionKey) {
  return tierForSection(sectionKey);
}

const STATUS_COLOR = {
  active: "#22c55e",
  working: "#f59e0b",
  attention: "#ef4444",
};

function StatusDot({ status }) {
  const color = STATUS_COLOR[status] || "#6b7280";
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
      title={status || "idle"}
    />
  );
}

function Avatar({ agent, size = 32 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-extrabold text-black"
      style={{ backgroundColor: agent.color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {agent.name[0]}
    </span>
  );
}

function MiniIcon({ name }) {
  const common = {
    className: "h-5 w-5 shrink-0",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.8,
    stroke: "currentColor",
  };
  switch (name) {
    case "missioncontrol":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0v-4.5m0-9V3m9 9h-4.5m-9 0H3m14.25 0a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z"
          />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
          />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
          />
        </svg>
      );
    default:
      return null;
  }
}

// Merge live status from /api/agents onto the static roster, preserving the
// canonical order and honoring department visibility (Sentinel is owner/admin).
function useRoster(canOpenDepartment) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getAgents();
        if (active) setLive(res.agents || []);
      } catch {
        if (active) setLive(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const statusById = {};
  if (Array.isArray(live)) for (const a of live) statusById[a.id] = a.status;

  return AGENTS_META.filter((a) => !canOpenDepartment || canOpenDepartment(a.id)).map((a) => ({
    ...a,
    status: statusById[a.id],
  }));
}

export default function Sidebar({
  section,
  deptAgentId,
  onSelectSection,
  onOpenDepartment,
  onLogout,
  isAdmin,
  isTeamMember = false,
  canOpenDepartment,
  workspaceRole = "owner",
  ownerBusinessName = null,
}) {
  const { branding } = useBranding();
  const isDefaultBrand = isDefaultBranding(branding);
  const brandTeal = branding.primaryColor || "#14B8A6";
  const roster = useRoster(canOpenDepartment);
  const [mobileTeamOpen, setMobileTeamOpen] = useState(false);

  const logo = branding.logoUrl ? (
    <img src={branding.logoUrl} alt={branding.agencyName} className="max-h-9 w-auto object-contain" />
  ) : isDefaultBrand ? (
    <img src="/zorecho-wordmark.png" alt="Zorecho" className="h-6 w-auto object-contain" />
  ) : (
    <span className="text-xl font-bold tracking-tight text-white">{branding.agencyName}</span>
  );

  const missionActive = section === "missioncontrol";
  const settingsActive = section === "settings";
  const adminActive = section === "admin";

  function selectMobile(fn) {
    setMobileTeamOpen(false);
    fn();
  }

  const AgentRow = ({ agent }) => {
    const active = section === "department" && deptAgentId === agent.id;
    return (
      <button
        onClick={() => onOpenDepartment(agent.id)}
        style={active ? { backgroundColor: `${agent.color}22`, borderLeftColor: agent.color } : { borderLeftColor: "transparent" }}
        className={`flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-2.5 py-2 text-left text-sm transition ${
          active ? "font-bold text-gray-100" : "font-medium text-gray-300 hover:bg-gray-800"
        }`}
      >
        <Avatar agent={agent} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{agent.name}</span>
          <span className="block truncate text-[11px] text-gray-500">{agent.title}</span>
        </span>
        <StatusDot status={agent.status} />
      </button>
    );
  };

  return (
    <>
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="hidden bg-black px-3 py-6 text-gray-100 md:flex md:h-screen md:w-64 md:flex-col md:overflow-y-auto">
        <div className="mb-6 flex items-center px-2">{logo}</div>

        {isTeamMember && (
          <div className="mb-4 rounded-lg bg-gray-900 px-3 py-2 text-xs">
            <div className="text-gray-500">
              {ownerBusinessName ? `${ownerBusinessName} workspace` : "Team workspace"}
            </div>
            <div className="mt-0.5 font-semibold capitalize text-amber-300">{workspaceRole} access</div>
          </div>
        )}

        <button
          data-tour="nav-missioncontrol"
          onClick={() => onSelectSection("missioncontrol")}
          style={missionActive ? { backgroundColor: `${brandTeal}22`, borderLeftColor: brandTeal, color: brandTeal } : { borderLeftColor: "transparent" }}
          className={`flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm transition ${
            missionActive ? "font-bold" : "font-semibold text-gray-200 hover:bg-gray-800"
          }`}
        >
          <MiniIcon name="missioncontrol" />
          <span>Mission Control</span>
        </button>

        <div className="mb-1 mt-5 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Your AI Team
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {roster.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </nav>

        {isAdmin && (
          <button
            data-tour="nav-admin"
            onClick={() => onSelectSection("admin")}
            style={adminActive ? { backgroundColor: `${brandTeal}22`, borderLeftColor: brandTeal, color: brandTeal } : { borderLeftColor: "transparent" }}
            className={`mt-3 flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm transition ${
              adminActive ? "font-semibold" : "font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <MiniIcon name="admin" />
            <span>Admin</span>
          </button>
        )}

        {isAdmin && (
          <button
            onClick={() => onSelectSection("corelab")}
            style={section === "corelab" ? { backgroundColor: `${brandTeal}22`, borderLeftColor: brandTeal, color: brandTeal } : { borderLeftColor: "transparent" }}
            className={`mt-1 flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm transition ${
              section === "corelab" ? "font-semibold" : "font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <MiniIcon name="admin" />
            <span>Core Lab</span>
            <span className="ml-auto rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-400">
              Beta
            </span>
          </button>
        )}

        <button
          onClick={() => onSelectSection("settings")}
          style={settingsActive ? { backgroundColor: `${brandTeal}22`, borderLeftColor: brandTeal, color: brandTeal } : { borderLeftColor: "transparent" }}
          className={`mt-1 flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm transition ${
            settingsActive ? "font-semibold" : "font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
        >
          <MiniIcon name="settings" />
          <span>Settings</span>
        </button>

        <button
          onClick={onLogout}
          className="mt-1 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          Log out
        </button>

        <MusicWidget />
      </aside>

      {/* ---------- Mobile top logo bar ---------- */}
      <div className="flex items-center justify-between bg-black px-4 py-3 text-gray-100 md:hidden">
        {logo}
        <button onClick={onLogout} className="text-sm font-medium text-gray-400 hover:text-white">
          Log out
        </button>
      </div>

      {/* ---------- Mobile team slide-up panel ---------- */}
      {mobileTeamOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileTeamOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-x-0 bottom-16 mx-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-800 bg-gray-950 p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Your AI Team
            </div>
            <div className="flex flex-col gap-0.5">
              {roster.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => selectMobile(() => onOpenDepartment(agent.id))}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-200 hover:bg-gray-800"
                >
                  <Avatar agent={agent} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{agent.name}</span>
                    <span className="block truncate text-[11px] text-gray-500">{agent.title}</span>
                  </span>
                  <StatusDot status={agent.status} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Mobile bottom nav ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-gray-800 bg-black md:hidden">
        <button
          onClick={() => selectMobile(() => onSelectSection("missioncontrol"))}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
            missionActive ? "text-white" : "text-gray-400"
          }`}
          style={missionActive ? { color: brandTeal } : undefined}
        >
          <MiniIcon name="missioncontrol" />
          <span>Mission</span>
        </button>
        <button
          onClick={() => setMobileTeamOpen((o) => !o)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
            section === "department" || mobileTeamOpen ? "text-white" : "text-gray-400"
          }`}
          style={section === "department" ? { color: brandTeal } : undefined}
        >
          <MiniIcon name="team" />
          <span>Team</span>
        </button>
        <button
          onClick={() => selectMobile(() => onSelectSection("settings"))}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
            settingsActive ? "text-white" : "text-gray-400"
          }`}
          style={settingsActive ? { color: brandTeal } : undefined}
        >
          <MiniIcon name="settings" />
          <span>Settings</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => selectMobile(() => onSelectSection("admin"))}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
              adminActive ? "text-white" : "text-gray-400"
            }`}
            style={adminActive ? { color: brandTeal } : undefined}
          >
            <MiniIcon name="admin" />
            <span>Admin</span>
          </button>
        )}
      </nav>
    </>
  );
}
