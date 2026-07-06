import { useEffect, useState } from "react";
import { api } from "../api";
import GoalsPanel from "./GoalsPanel";

/**
 * Self-fetching goals panel for a department dashboard (atlas/nova/pulse/roi).
 * Loads only the goals whose category belongs to that department. Renders
 * nothing when the brand has no goals in this department (keeps dashboards clean).
 */
export default function DepartmentGoals({
  brandId,
  department,
  title = "Goals",
  onManage,
  alwaysShow = false,
}) {
  const [state, setState] = useState({ loading: true, goals: [], score: null });

  useEffect(() => {
    let cancelled = false;
    if (!brandId || !department) {
      setState({ loading: false, goals: [], score: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    api
      .getDepartmentGoals(brandId, department)
      .then((data) => {
        if (cancelled) return;
        setState({
          loading: false,
          goals: Array.isArray(data.goals) ? data.goals : [],
          score: data.score ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, goals: [], score: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, department]);

  if (!state.loading && state.goals.length === 0 && !alwaysShow) return null;

  return (
    <div className="mb-6">
      <GoalsPanel
        title={title}
        goals={state.goals}
        score={state.score}
        loading={state.loading}
        showScore={state.goals.length > 0}
        onManage={onManage}
        emptyHint="No goals for this department yet."
      />
    </div>
  );
}
