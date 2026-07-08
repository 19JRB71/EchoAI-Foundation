import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "./Spinner.jsx";

// Where You Do Business — the brand's geographic service areas plus hard
// exclusion zones (shown in red). Exclusions are enforced everywhere: ads,
// content, research, and lead flagging. Sage can add compliance exclusions
// automatically; those are labeled so the owner knows where they came from.

const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const AREA_TYPES = [
  { value: "state", label: "Whole state" },
  { value: "county", label: "County" },
  { value: "city", label: "City" },
  { value: "zip", label: "Zip code" },
  { value: "radius", label: "Radius around a place" },
];

const EXCLUDE_TYPES = AREA_TYPES.filter((t) => t.value !== "radius");

function entryLabel(e) {
  if (e.type === "state") return US_STATES[String(e.value).toUpperCase()] || e.value;
  if (e.type === "zip") return `Zip ${e.value}`;
  if (e.type === "radius")
    return `${e.value}${e.state ? `, ${e.state}` : ""} (within ${e.radiusMiles} miles)`;
  const suffix = e.state ? `, ${e.state}` : "";
  return `${e.value}${suffix}${e.type === "county" ? " County" : ""}`;
}

function EntryEditor({ isExclusion, onAdd }) {
  const [type, setType] = useState("state");
  const [value, setValue] = useState("");
  const [state, setState] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("25");
  const [reason, setReason] = useState("");

  const needsState = type === "county" || type === "city" || type === "radius";

  const add = () => {
    const entry = { type };
    if (type === "state") {
      if (!value) return;
      entry.value = value;
    } else {
      if (!value.trim()) return;
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
        {(isExclusion ? EXCLUDE_TYPES : AREA_TYPES).map((t) => (
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
          <option value="">State (optional)</option>
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

export default function GeoTargetingCard({ brandId }) {
  const [areas, setAreas] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

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

  if (!brandId) return null;

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
                      onClick={() => { setAreas(areas.filter((_, j) => j !== i)); setDirty(true); }}
                      className="text-blue-300 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <EntryEditor isExclusion={false} onAdd={(e) => { setAreas([...areas, e]); setDirty(true); }} />
          </div>

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
                      onClick={() => { setExclusions(exclusions.filter((_, j) => j !== i)); setDirty(true); }}
                      className="text-red-300 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <EntryEditor isExclusion onAdd={(e) => { setExclusions([...exclusions, e]); setDirty(true); }} />
          </div>

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
