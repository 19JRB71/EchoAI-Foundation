import { useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";

// Admin control panel for the Demo Account & Sales Presentation Mode. Lets the
// admin seed/reset the "Premier Auto Group" demo data, re-brand it per prospect,
// and launch Presentation Mode (which switches the dashboard to the demo brand
// and shows the presenter toolbar).
export default function AdminDemo() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [scenario, setScenario] = useState("");
  const [listening, setListening] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.demoGetStatus();
      setStatus(data);
      setBusinessName(data.businessName || "");
      setProspectName(data.prospectName || "");
      setSuggestionsEnabled(data.suggestionsEnabled !== false);
      setScenario(data.customScenario || "");
    } catch (err) {
      setError(err.message || "Failed to load demo status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run(label, fn, successMsg) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const data = await fn();
      if (data) {
        // Merge, don't replace: some endpoints (e.g. adapt) return only a
        // partial payload, so a blind setStatus would drop seeded/active and
        // break the Presentation Mode controls until reload.
        setStatus((prev) => ({ ...prev, ...data }));
        if (data.businessName) setBusinessName(data.businessName);
        if (typeof data.prospectName === "string") setProspectName(data.prospectName);
      }
      if (successMsg) setNotice(successMsg);
      return data;
    } catch (err) {
      setError(err.message || "Something went wrong.");
      throw err;
    } finally {
      setBusy("");
    }
  }

  async function handleSeed() {
    await run("seed", () => api.demoSeed(businessName), "Demo data seeded.");
  }
  async function handleReset() {
    await run("reset", () => api.demoReset(), "Demo data reset to a clean state.");
  }
  async function handleSaveConfig() {
    await run(
      "config",
      () => api.demoUpdateConfig({ businessName, prospectName, suggestionsEnabled }),
      "Demo branding saved.",
    );
  }

  async function handleToggleSuggestions() {
    const next = !suggestionsEnabled;
    setSuggestionsEnabled(next);
    try {
      await run(
        "suggestions",
        () => api.demoUpdateConfig({ businessName, prospectName, suggestionsEnabled: next }),
        next ? "Live AI suggestions on." : "Live AI suggestions off.",
      );
    } catch {
      setSuggestionsEnabled(!next); // revert on failure
    }
  }

  async function handleAdaptScenario() {
    try {
      const data = await run(
        "adapt",
        () => api.demoAdaptSuggestions(scenario),
        scenario.trim()
          ? "Echo re-themed the suggestions to your scenario."
          : "Reverted to the default suggestions.",
      );
      if (data && typeof data.scenario === "string") setScenario(data.scenario);
    } catch {
      /* error already surfaced */
    }
  }

  // Optional voice input for the scenario. Uses the browser SpeechRecognition
  // API when available; degrades silently to typing (it is unavailable in the
  // preview iframe / unsupported browsers).
  function handleDictateScenario() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("Voice input isn't available here — please type the scenario instead.");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      setListening(true);
      rec.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript || "";
        if (text) setScenario((prev) => (prev ? `${prev} ${text}` : text));
      };
      rec.onerror = () => {
        setError("Couldn't capture audio — please type the scenario instead.");
        setListening(false);
      };
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
      setError("Voice input isn't available here — please type the scenario instead.");
    }
  }

  async function handleStart() {
    try {
      const data = await run("start", () => api.demoActivate());
      const brandId = (data && data.demoBrandId) || (status && status.demoBrandId);
      window.dispatchEvent(
        new CustomEvent("echoai:demo-start", { detail: { demoBrandId: brandId } }),
      );
    } catch {
      /* error already surfaced */
    }
  }

  async function handleStop() {
    await run("stop", () => api.demoDeactivate(), "Presentation Mode stopped.");
    window.dispatchEvent(new CustomEvent("echoai:demo-stop"));
  }

  if (loading) return <Spinner label="Loading demo…" />;

  const seeded = status && status.seeded;
  const active = status && status.active;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-100">
              Sales Presentation Mode
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              A fully-loaded demo dealership ("{status?.businessName || "Premier Auto Group"}")
              to run live sales demos. The data is isolated and inert — nothing
              ever sends, and it never mixes with real customer stats.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              active
                ? "bg-green-500/15 text-green-300"
                : seeded
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-gray-700/40 text-gray-400"
            }`}
          >
            {active ? "Live" : seeded ? "Ready" : "Not seeded"}
          </span>
        </div>

        {/* Master on/off toggle so the admin can jump in and out of Demo Mode
            instantly during a live sales call. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-label={active ? "Demo Mode is on" : "Demo Mode is off"}
              onClick={active ? handleStop : handleStart}
              disabled={!!busy || (!active && !seeded)}
              title={!active && !seeded ? "Seed the demo first" : ""}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? "bg-green-500" : "bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  active ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span
              className={`text-sm font-semibold ${
                active ? "text-green-300" : "text-gray-400"
              }`}
            >
              {active ? "Demo Mode ON" : "Demo Mode OFF"}
            </span>
          </div>
          {active ? (
            <button
              onClick={handleStop}
              disabled={!!busy}
              className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy === "stop" ? "Stopping…" : "Stop Demo Mode"}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!!busy || !seeded}
              title={seeded ? "" : "Seed the demo first"}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
            >
              {busy === "start" ? "Starting…" : "Start Presentation Mode"}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-lg bg-green-500/10 p-3 text-sm text-green-300">
            {notice}
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-gray-400">Demo business name</span>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Premier Auto Group"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-400">Prospect name (optional)</span>
            <input
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              placeholder="e.g. Dave"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          The prospect's name personalizes Echo's spoken demo lines ("Good morning, Dave…").
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleSaveConfig}
            disabled={!!busy}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {busy === "config" ? "Saving…" : "Save branding"}
          </button>
        </div>
      </div>

      {/* Live AI marketing suggestions -------------------------------------- */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-200">Live AI suggestions</h4>
            <p className="mt-1 text-sm text-gray-400">
              During the demo Echo proactively surfaces marketing suggestions on
              the relevant screens (budget, competitor, social, follow-ups,
              seasonal) with Accept / Dismiss. Great for showing what Echo does
              on its own.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={suggestionsEnabled}
            aria-label={suggestionsEnabled ? "Suggestions on" : "Suggestions off"}
            onClick={handleToggleSuggestions}
            disabled={!!busy}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              suggestionsEnabled ? "bg-teal-500" : "bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                suggestionsEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">
              Custom scenario (optional)
            </span>
            <button
              type="button"
              onClick={handleDictateScenario}
              disabled={!!busy}
              className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                listening
                  ? "border-teal-500 bg-teal-500/15 text-teal-300"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
              title="Speak the scenario (falls back to typing where unavailable)"
            >
              {listening ? "● Listening…" : "🎤 Speak"}
            </button>
          </div>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={3}
            placeholder="Describe the prospect's business so Echo tailors every example — e.g. 'They run a family Italian restaurant with catering and takeout.'"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-teal-500 focus:outline-none"
          />
          <p className="mt-2 text-xs text-gray-500">
            Echo rewrites all five suggestions to fit the scenario (products,
            channels, seasonality). Leave blank and save to revert to the default
            dealership examples.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handleAdaptScenario}
              disabled={!!busy}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
            >
              {busy === "adapt"
                ? "Adapting…"
                : scenario.trim()
                  ? "Adapt suggestions"
                  : "Revert to defaults"}
            </button>
            {status?.hasCustomSuggestions ? (
              <span className="rounded-full bg-teal-500/15 px-3 py-1 text-xs font-medium text-teal-300">
                Custom scenario active
              </span>
            ) : (
              <span className="rounded-full bg-gray-700/40 px-3 py-1 text-xs font-medium text-gray-400">
                Using default examples
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h4 className="text-sm font-semibold text-gray-200">Demo data</h4>
        <p className="mt-1 text-sm text-gray-400">
          {seeded
            ? `Seeded${status.seededAt ? " " + new Date(status.seededAt).toLocaleString() : ""}. Reset to restore a clean state before your next demo.`
            : "Seed the demo before starting Presentation Mode."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleSeed}
            disabled={!!busy}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {busy === "seed" ? "Seeding…" : seeded ? "Re-seed demo" : "Seed demo"}
          </button>
          {seeded && (
            <button
              onClick={handleReset}
              disabled={!!busy}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
            >
              {busy === "reset" ? "Resetting…" : "Reset demo"}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h4 className="text-sm font-semibold text-gray-200">Presentation</h4>
        <p className="mt-1 text-sm text-gray-400">
          Use the Demo Mode toggle at the top to start or stop Presentation Mode.
          Starting it switches your dashboard to the demo dealership and shows a
          presenter toolbar with guided steps and Echo's spoken pitch. Stopping it
          returns the dashboard to your real brands.
        </p>
      </div>
    </div>
  );
}
