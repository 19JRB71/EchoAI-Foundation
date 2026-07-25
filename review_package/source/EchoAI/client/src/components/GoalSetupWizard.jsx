import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import {
  BRAND_TYPES,
  BRAND_TYPE_KEYS,
  DEFAULT_BRAND_TYPE,
} from "../lib/goals.js";

// Sensible starting targets by unit so the wizard proposes something concrete
// (the user adjusts before saving). These are suggestions, never saved silently.
function defaultTargetFor(unit) {
  if (unit === "currency") return 5000;
  if (unit === "ratio") return 3;
  return 25;
}

const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60";
const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

/**
 * Conversational goal-setup wizard shown once after onboarding (Setup Agent).
 * Echo walks the owner through picking a business type and setting a first
 * handful of monthly targets. Nothing is fabricated — the wizard only proposes
 * defaults; the owner confirms real targets before anything is saved.
 */
export default function GoalSetupWizard({ brandId, onClose, onComplete }) {
  const [step, setStep] = useState("type"); // "type" -> "describe" -> "goals" -> "done"
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [brandType, setBrandType] = useState(DEFAULT_BRAND_TYPE);
  const [catalog, setCatalog] = useState([]);
  // selection: { [metricKey]: { on: bool, target: string } }
  const [selection, setSelection] = useState({});
  const [describeText, setDescribeText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState("");

  const buildSelection = useCallback((cat) => {
    const sel = {};
    cat.forEach((c, idx) => {
      sel[c.metricKey] = {
        on: idx < 3, // pre-select the first few most-relevant metrics
        target: String(defaultTargetFor(c.unit)),
      };
    });
    return sel;
  }, []);

  const loadCatalog = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getGoalCatalog(brandId);
      const bt = data.brandType || DEFAULT_BRAND_TYPE;
      const cat = Array.isArray(data.catalog) ? data.catalog : [];
      setBrandType(bt);
      setCatalog(cat);
      setSelection(buildSelection(cat));
    } catch (err) {
      setError(err.message || "Couldn't load goal options.");
    } finally {
      setLoading(false);
    }
  }, [brandId, buildSelection]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const changeType = async (type) => {
    setBrandType(type);
    setSaving(true);
    setError("");
    try {
      await api.updateBrand(brandId, { brand_type: type });
      const data = await api.getGoalCatalog(brandId);
      const cat = Array.isArray(data.catalog) ? data.catalog : [];
      setCatalog(cat);
      setSelection(buildSelection(cat));
    } catch (err) {
      setError(err.message || "Couldn't update business type.");
    } finally {
      setSaving(false);
    }
  };

  // Ask Echo to read the owner's plain-English goals and pre-select targets.
  // Non-blocking: on any failure the owner just picks goals manually.
  const applyDescription = async () => {
    const text = describeText.trim();
    if (!text) {
      setStep("goals");
      return;
    }
    setParsing(true);
    setParseNote("");
    setError("");
    try {
      const data = await api.parseGoals(brandId, text);
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      if (suggestions.length) {
        setSelection((prev) => {
          const next = { ...prev };
          for (const s of suggestions) {
            if (!next[s.metricKey]) continue; // ignore metrics not in this catalog
            next[s.metricKey] = { on: true, target: String(s.targetValue) };
          }
          return next;
        });
        setParseNote(
          `Got it — I set up ${suggestions.length} target${
            suggestions.length === 1 ? "" : "s"
          }. Review them below.`
        );
      } else {
        setParseNote(
          "I couldn't pin those to specific targets — pick the ones you want below."
        );
      }
      setStep("goals");
    } catch (err) {
      // 502 (AI down) or anything else must not block onboarding.
      setParseNote(
        "I couldn't reach the AI just now — no problem, pick your goals manually below."
      );
      setStep("goals");
    } finally {
      setParsing(false);
    }
  };

  const toggle = (key) =>
    setSelection((prev) => ({
      ...prev,
      [key]: { ...prev[key], on: !prev[key].on },
    }));

  const setTarget = (key, target) =>
    setSelection((prev) => ({ ...prev, [key]: { ...prev[key], target } }));

  const chosen = catalog.filter(
    (c) => selection[c.metricKey] && selection[c.metricKey].on
  );

  const saveGoals = async () => {
    setSaving(true);
    setError("");
    try {
      for (const c of chosen) {
        const target = Number(selection[c.metricKey].target);
        if (!Number.isFinite(target) || target < 0) continue;
        try {
          await api.createGoal(brandId, {
            metricKey: c.metricKey,
            targetValue: target,
          });
        } catch (err) {
          // A pre-existing goal for this metric (409) is fine — skip it.
          if (err.status !== 409) throw err;
        }
      }
      setStep("done");
    } catch (err) {
      setError(err.message || "Couldn't save your goals.");
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    if (onComplete) onComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
        {/* Echo header */}
        <div className="flex items-center gap-3 border-b border-gray-800 bg-gradient-to-r from-teal-950/60 to-gray-900 px-5 py-4">
          <span
            className="h-8 w-8 rounded-full"
            style={{
              background: "radial-gradient(circle at 30% 30%, #2dd4bf, #0f766e)",
              boxShadow: "0 0 12px #14b8a688",
            }}
          />
          <div>
            <div className="text-sm font-bold text-gray-100">Echo</div>
            <div className="text-xs text-teal-300">Let's set your targets</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-400">Loading your options…</p>
          ) : step === "type" ? (
            <>
              <p className="text-sm leading-relaxed text-gray-200">
                Now that we're set up, let's decide what winning looks like. First
                — what kind of business is this? It tunes the goals I'll track for
                you.
              </p>
              <div className="mt-4 space-y-2">
                {BRAND_TYPE_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => changeType(k)}
                    disabled={saving}
                    className={[
                      "w-full rounded-xl border p-3 text-left transition",
                      brandType === k
                        ? "border-teal-500 bg-teal-950/30"
                        : "border-gray-800 bg-gray-950/40 hover:border-gray-600",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold text-gray-100">
                      {BRAND_TYPES[k].label}
                    </div>
                    <div className="text-xs text-gray-400">
                      {BRAND_TYPES[k].description}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-5 flex justify-between">
                <button onClick={onClose} className={secondaryBtn}>
                  Skip for now
                </button>
                <button
                  onClick={() => setStep("describe")}
                  disabled={saving}
                  className={primaryBtn}
                >
                  Next
                </button>
              </div>
            </>
          ) : step === "describe" ? (
            <>
              <p className="text-sm leading-relaxed text-gray-200">
                Tell me what you're aiming for this month in your own words — like
                "around 40 new leads and keep cost per lead under $15" — and I'll
                set up the targets for you. Or skip and pick them yourself.
              </p>
              <textarea
                value={describeText}
                onChange={(e) => setDescribeText(e.target.value)}
                rows={4}
                placeholder="e.g. I want about 40 leads a month, 10 booked calls, and to keep cost per lead under $15."
                className={`${inputClass} mt-4 resize-none`}
              />
              <div className="mt-5 flex justify-between">
                <button
                  onClick={() => setStep("goals")}
                  disabled={parsing}
                  className={secondaryBtn}
                >
                  I'll pick manually
                </button>
                <button
                  onClick={applyDescription}
                  disabled={parsing}
                  className={primaryBtn}
                >
                  {parsing ? "Reading your goals…" : "Set them up for me"}
                </button>
              </div>
            </>
          ) : step === "goals" ? (
            <>
              {parseNote && (
                <div className="mb-3 rounded-lg border border-teal-900/60 bg-teal-950/30 px-3 py-2 text-xs text-teal-200">
                  {parseNote}
                </div>
              )}
              <p className="text-sm leading-relaxed text-gray-200">
                Here are the targets I'd suggest for a{" "}
                <span className="font-semibold text-teal-300">
                  {(BRAND_TYPES[brandType] || BRAND_TYPES[DEFAULT_BRAND_TYPE]).label}
                </span>
                . Turn any on or off and set the monthly number you're aiming for.
              </p>
              <div className="mt-4 space-y-2">
                {catalog.map((c) => {
                  const sel = selection[c.metricKey] || { on: false, target: "" };
                  return (
                    <div
                      key={c.metricKey}
                      className={[
                        "rounded-xl border p-3 transition",
                        sel.on
                          ? "border-teal-600/60 bg-teal-950/20"
                          : "border-gray-800 bg-gray-950/40",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={sel.on}
                            onChange={() => toggle(c.metricKey)}
                            className="h-4 w-4 accent-teal-500"
                          />
                          <span className="truncate text-sm font-semibold text-gray-100">
                            {c.label}
                          </span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={sel.target}
                          onChange={(e) => setTarget(c.metricKey, e.target.value)}
                          disabled={!sel.on}
                          className="w-24 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-gray-100 focus:border-amber-500 focus:outline-none disabled:opacity-50"
                        />
                      </div>
                      <p className="mt-1 pl-6 text-[11px] text-gray-500">
                        {c.description}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex justify-between">
                <button onClick={() => setStep("describe")} className={secondaryBtn}>
                  Back
                </button>
                <button
                  onClick={saveGoals}
                  disabled={saving || chosen.length === 0}
                  className={primaryBtn}
                >
                  {saving
                    ? "Saving…"
                    : `Set ${chosen.length} goal${chosen.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-gray-200">
                You're all set. I'll track these every day and let you know when
                you're ahead, on pace, or falling behind — and my team will
                optimize toward them automatically.
              </p>
              <div className="mt-5 flex justify-end">
                <button onClick={finish} className={primaryBtn}>
                  Take me to my dashboard
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
