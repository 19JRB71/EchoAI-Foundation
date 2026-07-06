import {
  statusMeta,
  scoreColor,
  formatValue,
  formatPercent,
  trendArrow,
  trendIsGood,
} from "../lib/goals";

// A circular 0–100 achievement score badge.
export function ScoreRing({ score, size = 64, label = "Score" }) {
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = scoreColor(score);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#1F2937"
          strokeWidth="6"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div
        className="mt-[-.5rem] text-center"
        style={{ marginTop: -(size / 2) - 6 }}
      >
        <div className="text-lg font-bold" style={{ color }}>
          {score == null ? "—" : Math.round(score)}
        </div>
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
    </div>
  );
}

// A single goal's progress row.
export function GoalRow({ goal }) {
  const meta = statusMeta(goal.status);
  const pct =
    goal.percentToGoal == null ? 0 : Math.max(0, Math.min(100, goal.percentToGoal));
  const good = trendIsGood(goal.trend, goal.direction);
  const trendColor = good == null ? "#9CA3AF" : good ? "#10B981" : "#EF4444";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-100">
            {goal.label}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            {formatValue(goal.currentValue, goal.unit)} of{" "}
            {formatValue(goal.targetValue, goal.unit)}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ color: meta.color, backgroundColor: meta.bg }}
        >
          {meta.label}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: meta.color }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-400">
        <span style={{ color: meta.color }}>
          {formatPercent(goal.percentToGoal)} to goal
        </span>
        <span className="flex items-center gap-2">
          {goal.trend && goal.trend !== "flat" && (
            <span style={{ color: trendColor }}>{trendArrow(goal.trend)}</span>
          )}
          {goal.projectedPercent != null && goal.aggregation === "cumulative" && (
            <span title="Projected end-of-month">
              proj {formatPercent(goal.projectedPercent)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Reusable goals panel. Renders a header (optional score), then a grid of goal
 * rows. When there are no goals it shows a soft empty state (never fabricated).
 */
export default function GoalsPanel({
  title = "Target Goals",
  goals,
  score,
  showScore = true,
  emptyHint = "No goals set yet.",
  onManage,
  loading,
}) {
  const list = Array.isArray(goals) ? goals : [];
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {showScore && <ScoreRing score={score} />}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-200">
              {title}
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              {list.length
                ? `${list.length} active goal${list.length === 1 ? "" : "s"} this month`
                : emptyHint}
            </p>
          </div>
        </div>
        {onManage && (
          <button
            onClick={onManage}
            className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
          >
            Manage Goals
          </button>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading goals…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyHint}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((g) => (
            <GoalRow key={g.goalId} goal={g} />
          ))}
        </div>
      )}
    </div>
  );
}
