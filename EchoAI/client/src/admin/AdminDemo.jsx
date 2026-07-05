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

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.demoGetStatus();
      setStatus(data);
      setBusinessName(data.businessName || "");
      setProspectName(data.prospectName || "");
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
        setStatus(data);
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
      () => api.demoUpdateConfig({ businessName, prospectName }),
      "Demo branding saved.",
    );
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
          Starting Presentation Mode switches your dashboard to the demo dealership
          and shows a presenter toolbar with guided steps and Echo's spoken pitch.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!active ? (
            <button
              onClick={handleStart}
              disabled={!!busy || !seeded}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
              title={seeded ? "" : "Seed the demo first"}
            >
              {busy === "start" ? "Starting…" : "Start Presentation Mode"}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={!!busy}
              className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy === "stop" ? "Stopping…" : "Stop Presentation Mode"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
