import { useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function AdminDiagnostics() {
  const [report, setReport] = useState("");
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const res = await api.adminGetDiagnostics();
      setReport(res.report || "");
      setGeneratedAt(res.generatedAt || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard — select the text and copy manually.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          Full Diagnostic Report
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Scans every part of your EchoAI account — brand configuration, posting
          schedule, campaigns, lead pipeline, goals, automation, integrations, API
          credits, voice, Sage intelligence and team — then lists the top 10 things
          to fix, highest priority first.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate Full Diagnostic Report"}
          </button>
          {report && (
            <button
              onClick={copy}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-gray-800"
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
          )}
          {generatedAt && !loading && (
            <span className="text-xs text-gray-500">
              Generated {new Date(generatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {loading && <Spinner label="Scanning your account…" />}
      {error && <ErrorBanner message={error} />}

      {report && !loading && (
        <pre className="max-h-[70vh] overflow-auto rounded-xl border border-gray-800 bg-gray-950 p-4 text-xs leading-relaxed text-gray-200 whitespace-pre-wrap font-mono">
          {report}
        </pre>
      )}
    </div>
  );
}
