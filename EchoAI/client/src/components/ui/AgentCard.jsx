// Zorecho AgentCard — one member of the executive roster.
//
// Communicates, in order: who they are, what they do, what they're doing
// right now, and whether they need attention. `activity` must be REAL —
// pass null and the card shows only the honest status label.

import StatusDot from "./StatusDot.jsx";

export default function AgentCard({
  agent, // { id, name, title, color }
  status = "waiting", // StatusDot status key
  activity = null, // real current activity string, or null
  active = false, // selected in the roster
  onClick = undefined,
  className = "",
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={[
        "font-inter group flex w-full items-center gap-3 rounded-z-ctrl border px-3.5 py-3 text-left",
        "transition-all duration-200 ease-out",
        active
          ? "border-z-line-bright bg-z-raised"
          : "border-transparent hover:border-z-line hover:bg-white/[0.03]",
        onClick
          ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-z-cyan/60"
          : "",
        className,
      ].join(" ")}
      style={
        active
          ? { boxShadow: `inset 2px 0 0 0 ${agent.color}` }
          : undefined
      }
    >
      {/* Avatar — agent color, soft light */}
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
        style={{
          color: agent.color,
          backgroundColor: `${agent.color}1a`,
          boxShadow: active ? `0 0 14px ${agent.color}40` : `inset 0 0 0 1px ${agent.color}33`,
          transition: "box-shadow 200ms ease",
        }}
      >
        {agent.name[0]}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-z-text">
            {agent.name}
          </span>
          <span className="truncate text-[11px] text-z-faint">{agent.title}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-z-dim">
          {activity || <StatusDot status={status} className="align-middle" />}
        </span>
      </span>

      {activity && <StatusDot status={status} label={null} />}
    </Tag>
  );
}
