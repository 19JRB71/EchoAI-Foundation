// Lightweight CSS bar chart — keeps the dashboard dependency-free and "simple".

export default function LeadsBarChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">No analytics data yet.</p>;
  }

  const max = Math.max(...data.map((d) => d.total_leads || 0), 1);

  return (
    <div className="flex h-48 items-end justify-around gap-4">
      {data.map((d) => {
        const leads = d.total_leads || 0;
        const heightPct = Math.round((leads / max) * 100);
        return (
          <div
            key={d.week_date}
            className="flex flex-1 flex-col items-center justify-end gap-2"
          >
            <span className="text-xs font-semibold text-gray-700">{leads}</span>
            <div
              className="w-full max-w-[48px] rounded-t-md bg-indigo-500 transition-all"
              style={{ height: `${Math.max(heightPct, 4)}%` }}
            />
            <span className="text-xs text-gray-400">{formatWeek(d.week_date)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatWeek(weekDate) {
  if (!weekDate) return "";
  const d = new Date(weekDate);
  if (Number.isNaN(d.getTime())) return String(weekDate);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
