import StarRating from "../../components/StarRating.jsx";
import { ReviewPlatformBadge, reviewPlatformMeta } from "./reviewPlatformMeta.jsx";

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-sky-400">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length === 0) {
    return (
      <p className="text-sm text-gray-500">No reviews in the last 30 days.</p>
    );
  }
  return (
    <div className="flex h-40 items-end justify-between gap-1.5">
      {trend.map((t) => {
        const heightPct = Math.round((t.avgRating / 5) * 100);
        return (
          <div
            key={t.day}
            className="group flex flex-1 flex-col items-center justify-end gap-1"
            title={`${t.day}: ${t.avgRating}★ avg (${t.count} review${t.count > 1 ? "s" : ""})`}
          >
            <span className="text-[10px] font-semibold text-amber-300">
              {t.avgRating}
            </span>
            <div
              className="w-full max-w-[28px] rounded-t bg-gradient-to-t from-sky-600 to-sky-400"
              style={{ height: `${Math.max(heightPct, 4)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function ReputationStats({ stats, loading }) {
  if (loading) return <p className="text-sm text-gray-400">Loading stats…</p>;
  if (!stats || stats.total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500">
        No reviews yet — sync or add reviews to see your reputation stats.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Average rating"
          value={stats.overallAvgRating != null ? `${stats.overallAvgRating}★` : "—"}
          sub={`across ${stats.total} reviews`}
        />
        <StatCard label="Total reviews" value={stats.total} />
        <StatCard
          label="Responded"
          value={`${stats.responseRate}%`}
          sub={`${stats.responded} of ${stats.total} reviews`}
        />
        <StatCard
          label="Needs response"
          value={stats.pending}
          sub={stats.ignored ? `${stats.ignored} ignored` : undefined}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          Average rating by platform
        </h3>
        <div className="space-y-3">
          {stats.byPlatform.map((p) => (
            <div key={p.platform} className="flex items-center gap-3">
              <ReviewPlatformBadge platform={p.platform} size={24} />
              <span className="w-20 text-sm text-gray-300">
                {reviewPlatformMeta(p.platform).label}
              </span>
              <StarRating value={Math.round(p.avgRating || 0)} size={14} />
              <span className="text-sm font-semibold text-gray-100">
                {p.avgRating != null ? p.avgRating : "—"}
              </span>
              <span className="text-xs text-gray-500">({p.total})</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-gray-200">
          Rating trend (last 30 days)
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          Average star rating per day of reviews received.
        </p>
        <TrendChart trend={stats.trend} />
      </div>
    </div>
  );
}
