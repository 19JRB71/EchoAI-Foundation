import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api";
import Spinner from "./Spinner.jsx";
import FloridaRegionMap from "./FloridaRegionMap.jsx";
import USStateTileMap from "./USStateTileMap.jsx";
import { US_STATES, STATE_REGIONS, REGION_BY_CODE } from "../lib/geoRegions";

// Where You Do Business — the brand's geographic service areas plus hard
// exclusion zones (shown in red). Exclusions are enforced everywhere: ads,
// content, research, and lead flagging. Sage can add compliance exclusions
// automatically; those are labeled so the owner knows where they came from.
//
// The "Never market here" section only appears when it makes sense: targeting
// the whole US or 2+ states (or when exclusions already exist). At a single
// state/city level there's nothing meaningful to exclude.

const AREA_TYPES = [
  { value: "city", label: "City" },
  { value: "county", label: "County" },
  { value: "zip", label: "Zip code" },
  { value: "radius", label: "Radius around a place" },
];

const EXCLUDE_TYPES = [
  { value: "state", label: "Whole state" },
  { value: "county", label: "County" },
  { value: "city", label: "City" },
  { value: "zip", label: "Zip code" },
];

const BIG_STATES = ["FL", "TX", "CA", "NY"];

function entryLabel(e) {
  if (e.label) return e.label;
  if (e.type === "country") return "United States (nationwide)";
  if (e.type === "region") return (REGION_BY_CODE[e.value] || {}).name || e.value;
  if (e.type === "state") return US_STATES[String(e.value).toUpperCase()] || e.value;
  if (e.type === "zip") return `Zip ${e.value}`;
  if (e.type === "radius")
    return `${e.value}${e.state ? `, ${e.state}` : ""} (within ${e.radiusMiles} miles)`;
  const suffix = e.state ? `, ${e.state}` : "";
  return `${e.value}${suffix}${e.type === "county" ? " County" : ""}`;
}

function EntryEditor({ isExclusion, onAdd }) {
  const types = isExclusion ? EXCLUDE_TYPES : AREA_TYPES;
  const [type, setType] = useState(types[0].value);
  const [value, setValue] = useState("");
  const [state, setState] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("25");
  const [reason, setReason] = useState("");

  const needsState = type === "county" || type === "city" || type === "radius";
  // The server requires a state for cities and counties (names repeat across
  // states) — enforce it here so nothing fails only at save time.
  const stateRequired = type === "county" || type === "city";

  const add = () => {
    const entry = { type };
    if (type === "state") {
      if (!value) return;
      entry.value = value;
    } else {
      if (!value.trim()) return;
      if (stateRequired && !state) return;
      entry.value = value.trim();
      if (needsState && state) entry.state = state;
      if (type === "radius") entry.radiusMiles = Number(radiusMiles) || 25;
    }
    if (isExclusion && reason.trim()) entry.reason = reason.trim();
    onAdd(entry);
    setValue("");
    setReason("");
  };

  const inputCls =
    "rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={type} onChange={(e) => { setType(e.target.value); setValue(""); }} className={inputCls}>
        {types.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      {type === "state" ? (
        <select value={value} onChange={(e) => setValue(e.target.value)} className={inputCls}>
          <option value="">Pick a state…</option>
          {Object.entries(US_STATES).map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            type === "zip" ? "e.g. 33101" : type === "county" ? "e.g. Miami-Dade" : "e.g. Miami"
          }
          className={`${inputCls} w-36`}
        />
      )}
      {needsState && (
        <select value={state} onChange={(e) => setState(e.target.value)} className={inputCls}>
          <option value="">{stateRequired ? "Pick the state…" : "State (optional)"}</option>
          {Object.entries(US_STATES).map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      )}
      {type === "radius" && (
        <label className="flex items-center gap-1 text-xs text-gray-400">
          within
          <input
            type="number"
            min="1"
            max="500"
            value={radiusMiles}
            onChange={(e) => setRadiusMiles(e.target.value)}
            className={`${inputCls} w-16`}
          />
          miles
        </label>
      )}
      {isExclusion && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why? (optional)"
          className={`${inputCls} w-40`}
        />
      )}
      <button
        type="button"
        onClick={add}
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
          isExclusion
            ? "bg-red-600/80 text-white hover:bg-red-600"
            : "bg-blue-600/80 text-white hover:bg-blue-600"
        }`}
      >
        Add
      </button>
    </div>
  );
}

// Regional checkboxes for a big state (FL/TX/CA/NY) + "All of <state>".
function StateRegionPicker({ stateCode, areas, onToggleState, onToggleRegion }) {
  const regions = STATE_REGIONS[stateCode] || [];
  const wholeState = areas.some((a) => a.type === "state" && a.value === stateCode);
  const selectedRegions = areas
    .filter((a) => a.type === "region" && a.state === stateCode)
    .map((a) => a.value);

  return (
    <div className="mt-2 flex flex-wrap items-start gap-4 rounded-xl border border-gray-800 bg-gray-950/50 p-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={wholeState}
            onChange={() => onToggleState(stateCode)}
            className="mt-0.5 accent-blue-500"
          />
          <span className="font-semibold">All of {US_STATES[stateCode]}</span>
        </label>
        {regions.map((r) => (
          <label key={r.code} className="flex cursor-pointer items-start gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={selectedRegions.includes(r.code)}
              onChange={() => onToggleRegion(r.code, stateCode)}
              className="mt-0.5 accent-blue-500"
              disabled={wholeState}
            />
            <span className={wholeState ? "opacity-50" : ""}>
              <span className="font-medium">{r.name}</span>
              <span className="block text-xs text-gray-500">{r.cities.join(", ")}</span>
            </span>
          </label>
        ))}
        {wholeState && regions.length > 0 && (
          <div className="text-xs text-gray-500">
            The whole state is selected — regional picks aren't needed.
          </div>
        )}
      </div>
      {stateCode === "FL" && (
        <FloridaRegionMap
          selected={wholeState ? Object.keys(REGION_SHAPE_CODES) : selectedRegions}
        />
      )}
    </div>
  );
}

const REGION_SHAPE_CODES = Object.fromEntries((STATE_REGIONS.FL || []).map((r) => [r.code, true]));

export default function GeoTargetingCard({ brandId }) {
  const [areas, setAreas] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showStates, setShowStates] = useState(false);
  const [openBigState, setOpenBigState] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getGeoTargeting(brandId);
      setAreas(data.areas || []);
      setExclusions(data.exclusions || []);
      setSummary(data.summary || null);
      setDirty(false);
    } catch (err) {
      setError(err.message || "Could not load your service areas.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const data = await api.updateGeoTargeting(brandId, { areas, exclusions });
      setAreas(data.areas || []);
      setExclusions(data.exclusions || []);
      setSummary(data.summary || null);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err.message || "Could not save your service areas.");
    } finally {
      setSaving(false);
    }
  };

  const nationwide = useMemo(() => areas.some((a) => a.type === "country"), [areas]);
  const selectedStates = useMemo(
    () => areas.filter((a) => a.type === "state").map((a) => String(a.value).toUpperCase()),
    [areas]
  );
  // Unique states covered by any state-scoped targeting (state picks, regional
  // picks, cities/counties/radius with a state) — drives exclusion visibility.
  const coveredStates = useMemo(() => {
    const set = new Set();
    for (const a of areas) {
      if (a.type === "state") set.add(String(a.value).toUpperCase());
      else if (a.state) set.add(String(a.state).toUpperCase());
    }
    return set;
  }, [areas]);
  const excludedStates = useMemo(
    () => exclusions.filter((x) => x.type === "state").map((x) => String(x.value).toUpperCase()),
    [exclusions]
  );

  // Exclusions only make sense when the coverage is broad: nationwide or
  // multiple states. Always shown if exclusions already exist (so nothing is
  // ever hidden/stuck).
  const showExclusionSection =
    nationwide || coveredStates.size >= 2 || exclusions.length > 0;

  const mutateAreas = (next) => { setAreas(next); setDirty(true); };
  const mutateExclusions = (next) => { setExclusions(next); setDirty(true); };

  const toggleNationwide = () => {
    if (nationwide) {
      mutateAreas(areas.filter((a) => a.type !== "country"));
    } else {
      mutateAreas([{ type: "country", value: "US" }, ...areas]);
    }
  };

  const toggleState = (code) => {
    const has = selectedStates.includes(code);
    if (has) {
      mutateAreas(areas.filter((a) => !(a.type === "state" && String(a.value).toUpperCase() === code)));
    } else {
      // Selecting the whole state supersedes that state's regional picks.
      mutateAreas([
        ...areas.filter((a) => !(a.type === "region" && a.state === code)),
        { type: "state", value: code },
      ]);
    }
  };

  const toggleRegion = (regionCode, stateCode) => {
    const has = areas.some((a) => a.type === "region" && a.value === regionCode);
    if (has) {
      mutateAreas(areas.filter((a) => !(a.type === "region" && a.value === regionCode)));
    } else {
      mutateAreas([...areas, { type: "region", value: regionCode, state: stateCode }]);
    }
  };

  const toggleExcludedState = (code) => {
    const has = excludedStates.includes(code);
    if (has) {
      mutateExclusions(
        exclusions.filter((x) => !(x.type === "state" && String(x.value).toUpperCase() === code))
      );
    } else {
      mutateExclusions([...exclusions, { type: "state", value: code }]);
    }
  };

  if (!brandId) return null;

  const checkCls = "accent-blue-500";

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="mb-1 text-base font-bold text-gray-100">Where You Do Business</div>
      <p className="mb-4 text-sm text-gray-400">
        Tell your AI team where to market — and where never to. Excluded areas are a
        hard block everywhere: ads, posts, research, and lead alerts.
      </p>

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {/* United States quick select */}
          <button
            type="button"
            onClick={toggleNationwide}
            aria-pressed={nationwide}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
              nationwide
                ? "border-green-600 bg-green-950/40 text-green-200"
                : "border-gray-700 bg-gray-950/60 text-gray-200 hover:border-blue-600"
            }`}
          >
            <span>🇺🇸 Target the entire United States</span>
            <span className={`text-xs font-normal ${nationwide ? "text-green-300" : "text-gray-500"}`}>
              {nationwide ? "On — click to turn off" : "One click, nationwide"}
            </span>
          </button>

          {nationwide && (
            <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3">
              <div className="mb-1 text-sm font-semibold text-gray-200">
                Click any state to exclude it
              </div>
              <p className="mb-2 text-xs text-gray-500">
                Green states are targeted. Red states are excluded — your AI team will
                never market there (useful when certain states are restricted).
              </p>
              <USStateTileMap excluded={excludedStates} onToggleState={toggleExcludedState} />
            </div>
          )}

          {/* Current selections */}
          <div>
            <div className="mb-2 text-sm font-semibold text-gray-200">
              Service areas {areas.length === 0 && (
                <span className="ml-1 font-normal text-gray-500">(none set — marketing runs nationwide)</span>
              )}
            </div>
            {areas.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {areas.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-700/50 bg-blue-950/40 px-3 py-1 text-xs text-blue-200"
                  >
                    {entryLabel(a)}
                    <button
                      type="button"
                      aria-label={`Remove ${entryLabel(a)}`}
                      onClick={() => mutateAreas(areas.filter((_, j) => j !== i))}
                      className="text-blue-300 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Multi-state checkboxes */}
            <button
              type="button"
              onClick={() => setShowStates(!showStates)}
              className="mb-2 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-1.5 text-sm text-gray-200 hover:border-blue-600"
            >
              {showStates ? "Hide state list" : "Choose states…"}
              {selectedStates.length > 0 && (
                <span className="ml-1.5 text-xs text-blue-300">({selectedStates.length} selected)</span>
              )}
            </button>

            {showStates && (
              <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl border border-gray-800 bg-gray-950/50 p-3 sm:grid-cols-3 md:grid-cols-4">
                {Object.entries(US_STATES).map(([code, name]) => (
                  <label key={code} className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedStates.includes(code)}
                      onChange={() => toggleState(code)}
                      className={checkCls}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}

            {/* Regional breakdowns for big states */}
            <div className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Regional targeting (big states)
              </div>
              <div className="flex flex-wrap gap-2">
                {BIG_STATES.map((code) => {
                  const active =
                    openBigState === code ||
                    selectedStates.includes(code) ||
                    areas.some((a) => a.type === "region" && a.state === code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setOpenBigState(openBigState === code ? "" : code)}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        active
                          ? "border-blue-600 bg-blue-950/40 text-blue-200"
                          : "border-gray-700 bg-gray-950/60 text-gray-300 hover:border-blue-600"
                      }`}
                    >
                      {US_STATES[code]}
                    </button>
                  );
                })}
              </div>
              {openBigState && (
                <StateRegionPicker
                  stateCode={openBigState}
                  areas={areas}
                  onToggleState={toggleState}
                  onToggleRegion={toggleRegion}
                />
              )}
            </div>

            {/* City / county / zip / radius */}
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Add a city, county, zip, or radius
            </div>
            <EntryEditor isExclusion={false} onAdd={(e) => mutateAreas([...areas, e])} />
          </div>

          {/* Exclusions — only shown when coverage is broad enough to need them */}
          {showExclusionSection && (
            <div>
              <div className="mb-2 text-sm font-semibold text-red-300">
                Never market here {exclusions.length === 0 && (
                  <span className="ml-1 font-normal text-gray-500">(no excluded areas)</span>
                )}
              </div>
              {exclusions.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {exclusions.map((x, i) => (
                    <span
                      key={i}
                      title={x.reason || undefined}
                      className="inline-flex items-center gap-1.5 rounded-full border border-red-700/60 bg-red-950/40 px-3 py-1 text-xs text-red-200"
                    >
                      {entryLabel(x)}
                      {x.addedBy === "sage" && (
                        <span className="rounded bg-red-900/80 px-1 text-[10px] uppercase tracking-wide text-red-300">
                          Sage · compliance
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${entryLabel(x)}`}
                        onClick={() => mutateExclusions(exclusions.filter((_, j) => j !== i))}
                        className="text-red-300 hover:text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <EntryEditor isExclusion onAdd={(e) => mutateExclusions([...exclusions, e])} />
            </div>
          )}

          {summary && !dirty && (
            <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 text-sm text-gray-300">
              {summary}
            </div>
          )}

          {error && <div className="text-sm text-red-400">{error}</div>}
          {saved && <div className="text-sm text-green-400">Saved. Your AI team will follow this everywhere.</div>}

          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save service areas"}
          </button>
        </div>
      )}
    </div>
  );
}
