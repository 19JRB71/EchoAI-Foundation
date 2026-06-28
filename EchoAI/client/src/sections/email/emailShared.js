// Shared helpers for the Email Marketing tabs.

export const SEGMENTS = [
  { value: "all", label: "All contacts" },
  { value: "hot", label: "Hot leads" },
  { value: "warm", label: "Warm leads" },
  { value: "cold", label: "Cold leads" },
  { value: "customers", label: "Customers" },
];

export function segmentLabel(value) {
  const s = SEGMENTS.find((x) => x.value === value);
  return s ? s.label : value || "All contacts";
}

export function pct(rate) {
  return `${Math.round((Number(rate) || 0) * 100)}%`;
}

export const STATUS_STYLES = {
  draft: "bg-gray-700/40 text-gray-300",
  scheduled: "bg-blue-500/15 text-blue-300",
  sending: "bg-amber-500/15 text-amber-300",
  sent: "bg-green-500/15 text-green-300",
  paused: "bg-orange-500/15 text-orange-300",
};

export function statusBadgeClass(status) {
  return STATUS_STYLES[status] || "bg-gray-700/40 text-gray-300";
}
