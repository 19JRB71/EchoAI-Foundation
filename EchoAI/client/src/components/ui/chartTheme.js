// Zorecho chart theme — token values for the existing SVG chart components.
// Charts adopt these in later phases; agent-series always use the agent's
// permanent color from lib/departments.js.

import { AGENTS_META } from "../../lib/departments.js";

export const CHART = {
  grid: "rgba(148, 163, 184, 0.08)",
  axis: "#64748B",
  label: "#94A3B8",
  line: "#3B82F6",
  accent: "#22D3EE",
  positive: "#10B981",
  negative: "#EF4444",
  tooltipBg: "#0B111E",
  tooltipBorder: "rgba(148, 163, 184, 0.26)",
  areaFrom: "rgba(59, 130, 246, 0.25)",
  areaTo: "rgba(59, 130, 246, 0)",
};

// { echo: "#14B8A6", scout: "#0EA5E9", ... } — permanent, used everywhere.
export const AGENT_COLORS = Object.fromEntries(
  AGENTS_META.map((a) => [a.id, a.color])
);
