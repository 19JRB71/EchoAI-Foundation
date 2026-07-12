// Zorecho StatusDot — honest agent/system status. These are the ONLY approved
// status labels (per creative direction: never fake activity):
//
//   running          — actively working (soft green presence pulse)
//   waiting          — healthy, idle until scheduled work (steady blue)
//   paused           — intentionally paused by the owner (steady gray)
//   needs_connection — a required integration is not linked (steady amber)
//   disabled         — feature off / not in plan (dim gray)
//   attention        — something requires the owner (soft red presence pulse)
//
// Pulses are opacity-only and slow — presence, never alarm.

export const STATUS_META = {
  running: { label: "Running", color: "#10B981", pulse: true },
  waiting: { label: "Waiting", color: "#3B82F6", pulse: false },
  paused: { label: "Paused", color: "#64748B", pulse: false },
  needs_connection: { label: "Needs Connection", color: "#F59E0B", pulse: false },
  disabled: { label: "Disabled", color: "#475569", pulse: false },
  attention: { label: "Attention Required", color: "#EF4444", pulse: true },
};

export default function StatusDot({
  status = "waiting",
  label = undefined, // override text; pass null to hide the label
  className = "",
}) {
  const meta = STATUS_META[status] || STATUS_META.waiting;
  const text = label === undefined ? meta.label : label;
  return (
    <span className={`font-inter inline-flex items-center gap-1.5 ${className}`}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.pulse ? "z-anim animate-z-presence" : ""}`}
        style={{ backgroundColor: meta.color, boxShadow: `0 0 6px ${meta.color}80` }}
      />
      {text !== null && (
        <span className="text-xs font-medium text-z-dim">{text}</span>
      )}
    </span>
  );
}
