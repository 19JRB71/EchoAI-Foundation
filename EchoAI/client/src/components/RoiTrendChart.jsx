// Lightweight CSS chart for the 12-week ROI trend. Dependency-free (matches the
// rest of the dashboard). Bars = weekly estimated value generated; the number
// above each bar is that week's leads.

function formatWeek(weekDate) {
  if (!weekDate) return "";
  const d = new Date(weekDate);
  if (Number.isNaN(d.getTime())) return String(weekDate);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

export default function RoiTrendChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">No ROI history yet.</p>;
  }

  const max = Math.max(...data.map((d) => Number(d.totalRoiEstimate) || 0), 1);

  return (
    <div className="flex h-56 items-end justify-between gap-2">
      {data.map((d) => {
        const value = Number(d.totalRoiEstimate) || 0;
        const heightPct = Math.round((value / max) * 100);
        return (
          <div
            key={d.weekDate}
            className="group flex flex-1 flex-col items-center justify-end gap-1.5"
            title={`${formatWeek(d.weekDate)} • ${money(value)} value • ${d.totalLeads} leads`}
          >
            <span className="text-[10px] font-semibold text-amber-300">
              {money(value)}
            </span>
            <div
              className="w-full max-w-[36px] rounded-t-md bg-gradient-to-t from-amber-600 to-amber-400 transition-all group-hover:from-amber-500 group-hover:to-amber-300"
              style={{ height: `${Math.max(heightPct, 3)}%` }}
            />
            <span className="text-[10px] text-gray-500">
              {formatWeek(d.weekDate)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
