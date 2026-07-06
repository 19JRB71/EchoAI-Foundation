import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import {
  BRAND_TYPES,
  BRAND_TYPE_KEYS,
  DEFAULT_BRAND_TYPE,
  formatValue,
  statusMeta,
  formatPercent,
} from "../lib/goals.js";

const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60";

/**
 * Settings card for a brand's target goals: brand-type selector (which decides
 * the available metrics) + create / edit / delete of per-metric monthly goals
 * with live progress. Available on every tier.
 */
export default function GoalEditorCard({ brandId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [brandType, setBrandType] = useState(DEFAULT_BRAND_TYPE);
  const [catalog, setCatalog] = useState([]);
  const [goals, setGoals] = useState([]);
  const [score, setScore] = useState(null);
  const [savingType, setSavingType] = useState(false);

  // New-goal form.
  const [newMetric, setNewMetric] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getGoals(brandId);
      setBrandType(data.brandType || DEFAULT_BRAND_TYPE);
      setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
      setGoals(Array.isArray(data.goals) ? data.goals : []);
      setScore(data.score ?? null);
    } catch (err) {
      setError(err.message || "Couldn't load goals.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeMetricKeys = new Set(goals.map((g) => g.metricKey));
  const available = catalog.filter((c) => !activeMetricKeys.has(c.metricKey));

  const changeBrandType = async (type) => {
    if (type === brandType) return;
    setSavingType(true);
    setError("");
    setNotice("");
    try {
      await api.updateBrand(brandId, { brand_type: type });
      setNotice("Business type updated — goal options refreshed.");
      // Reload catalog (available metrics change with the type).
      const cat = await api.getGoalCatalog(brandId);
      setBrandType(cat.brandType || type);
      setCatalog(Array.isArray(cat.catalog) ? cat.catalog : []);
    } catch (err) {
      setError(err.message || "Couldn't update business type.");
    } finally {
      setSavingType(false);
    }
  };

  const addGoal = async (e) => {
    e.preventDefault();
    if (!newMetric || newTarget === "") return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      await api.createGoal(brandId, {
        metricKey: newMetric,
        targetValue: Number(newTarget),
        label: newLabel.trim() || undefined,
      });
      setNewMetric("");
      setNewTarget("");
      setNewLabel("");
      await load();
    } catch (err) {
      setError(err.message || "Couldn't create goal.");
    } finally {
      setCreating(false);
    }
  };

  const saveTarget = async (goal, targetValue) => {
    const t = Number(targetValue);
    if (!Number.isFinite(t) || t < 0 || t === Number(goal.targetValue)) return;
    setError("");
    try {
      await api.updateGoal(brandId, goal.goalId, { targetValue: t });
      await load();
    } catch (err) {
      setError(err.message || "Couldn't update goal.");
    }
  };

  const removeGoal = async (goal) => {
    setError("");
    try {
      await api.deleteGoal(brandId, goal.goalId);
      setGoals((prev) => prev.filter((g) => g.goalId !== goal.goalId));
    } catch (err) {
      setError(err.message || "Couldn't delete goal.");
    }
  };

  if (!brandId) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400">
        Select a business to manage its target goals.
      </div>
    );
  }

  const selectedMeta = catalog.find((c) => c.metricKey === newMetric);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-200">
          Target Goals & KPIs
        </h3>
        {score != null && (
          <span className="text-xs text-gray-400">
            Achievement score:{" "}
            <span className="font-bold text-gray-100">{score}/100</span>
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Set monthly targets and your AI team optimizes toward them. Progress is
        measured from your real activity.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg border border-teal-900/60 bg-teal-950/30 px-3 py-2 text-xs text-teal-200">
          {notice}
        </div>
      )}

      {/* Business type */}
      <div className="mb-5">
        <label className="mb-1 block text-xs font-semibold text-gray-300">
          Business type
        </label>
        <select
          value={brandType}
          onChange={(e) => changeBrandType(e.target.value)}
          disabled={savingType || loading}
          className={inputClass}
        >
          {BRAND_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>
              {BRAND_TYPES[k].label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-gray-500">
          {(BRAND_TYPES[brandType] || BRAND_TYPES[DEFAULT_BRAND_TYPE]).description}
        </p>
      </div>

      {/* Active goals */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="mb-4 text-sm text-gray-500">
          No goals yet. Add your first target below.
        </p>
      ) : (
        <div className="mb-5 space-y-2">
          {goals.map((g) => {
            const m = statusMeta(g.status);
            return (
              <div
                key={g.goalId}
                className="rounded-lg border border-gray-800 bg-gray-950/50 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-gray-100">
                      {g.label}
                    </span>
                    <span
                      className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ color: m.color, backgroundColor: m.bg }}
                    >
                      {m.label} · {formatPercent(g.percentToGoal)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      Now {formatValue(g.currentValue, g.unit)} · Target
                    </span>
                    <input
                      type="number"
                      defaultValue={g.targetValue}
                      min="0"
                      step="any"
                      onBlur={(e) => saveTarget(g, e.target.value)}
                      className="w-24 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      onClick={() => removeGoal(g)}
                      className="rounded-md border border-gray-700 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add a goal */}
      {available.length > 0 ? (
        <form
          onSubmit={addGoal}
          className="rounded-lg border border-dashed border-gray-700 p-3"
        >
          <div className="mb-2 text-xs font-semibold text-gray-300">
            Add a goal
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
            <select
              value={newMetric}
              onChange={(e) => setNewMetric(e.target.value)}
              className={inputClass}
            >
              <option value="">Choose a metric…</option>
              {available.map((c) => (
                <option key={c.metricKey} value={c.metricKey}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="any"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="Target"
              className={inputClass}
            />
          </div>
          {selectedMeta && (
            <p className="mt-1 text-[11px] text-gray-500">
              {selectedMeta.description}
            </p>
          )}
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Custom label (optional)"
            maxLength={160}
            className={`${inputClass} mt-2`}
          />
          <div className="mt-3">
            <button
              type="submit"
              disabled={creating || !newMetric || newTarget === ""}
              className={primaryBtn}
            >
              {creating ? "Adding…" : "Add goal"}
            </button>
          </div>
        </form>
      ) : (
        !loading && (
          <p className="text-xs text-gray-500">
            You've set goals for every available metric for this business type.
          </p>
        )
      )}
    </div>
  );
}
