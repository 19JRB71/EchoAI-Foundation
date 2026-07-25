import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import SalesScriptView, { salesScriptToText } from "./SalesScriptView.jsx";

const SALE_TYPES = [
  { key: "cold_call", label: "Cold Call" },
  { key: "warm_follow_up", label: "Warm Follow-Up" },
  { key: "in_person_meeting", label: "In-Person Meeting" },
];

export default function ScriptGenerator({ brandId, onSaved }) {
  const [saleType, setSaleType] = useState("cold_call");
  const [targetPersona, setTargetPersona] = useState("");
  const [commonObjections, setCommonObjections] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { script, saleType, targetPersona, desiredOutcome }

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaveError("");
    if (!targetPersona.trim()) {
      setError("Describe the target customer persona for this script.");
      return;
    }
    if (!desiredOutcome.trim()) {
      setError("Describe the desired outcome of the conversation.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const data = await api.generateSalesScript({
        brandId,
        saleType,
        targetPersona: targetPersona.trim(),
        commonObjections: commonObjections.trim(),
        desiredOutcome: desiredOutcome.trim(),
      });
      setResult({
        script: data.script,
        saleType: data.saleType,
        targetPersona: data.targetPersona,
        desiredOutcome: data.desiredOutcome,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      await api.saveSalesScript({
        brandId,
        saleType: result.saleType,
        targetPersona: result.targetPersona,
        scriptContent: result.script,
      });
      setNotice("Script saved.");
      if (onSaved) onSaved();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    const text = salesScriptToText(result.script, {
      saleType: result.saleType,
      targetPersona: result.targetPersona,
      desiredOutcome: result.desiredOutcome,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveError("Could not copy to clipboard.");
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleGenerate}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Type of sale
            </label>
            <select
              value={saleType}
              onChange={(e) => setSaleType(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {SALE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Target customer persona
            </label>
            <input
              type="text"
              value={targetPersona}
              onChange={(e) => setTargetPersona(e.target.value)}
              placeholder="e.g. Owner of a 10-30 person dental practice"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Desired outcome of the conversation
          </label>
          <input
            type="text"
            value={desiredOutcome}
            onChange={(e) => setDesiredOutcome(e.target.value)}
            placeholder="e.g. Book a 20-minute demo call"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Most common objections{" "}
            <span className="text-gray-500">(optional, one per line)</span>
          </label>
          <textarea
            value={commonObjections}
            onChange={(e) => setCommonObjections(e.target.value)}
            rows={4}
            placeholder={"It's too expensive\nWe already use someone else\nI need to think about it"}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate Script"}
        </button>
      </form>

      {loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Writing your sales script…
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Script"}
            </button>
            <button
              onClick={handleCopy}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800"
            >
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>

          {notice && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
              {notice}
            </p>
          )}
          <ErrorBanner message={saveError} />

          <SalesScriptView
            script={result.script}
            saleType={result.saleType}
            targetPersona={result.targetPersona}
            desiredOutcome={result.desiredOutcome}
          />
        </div>
      )}
    </div>
  );
}
