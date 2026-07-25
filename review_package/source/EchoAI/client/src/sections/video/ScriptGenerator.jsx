import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import VideoPackageView, { videoPackageToText } from "./VideoPackageView.jsx";

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube"];
const PLATFORM_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

const LENGTHS = [
  { key: "short", label: "Short — under 60 seconds" },
  { key: "medium", label: "Medium — 1 to 3 minutes" },
  { key: "long", label: "Long — 5 to 10 minutes" },
];

export default function ScriptGenerator({ brandId, onSaved }) {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("tiktok");
  const [length, setLength] = useState("short");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { videoPackage, platform, length, topic }

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaveError("");
    if (!topic.trim()) {
      setError("Enter a video topic or goal to generate a script.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const data = await api.generateVideoScript({
        brandId,
        topic: topic.trim(),
        platform,
        length,
      });
      setResult({
        videoPackage: data.videoPackage,
        platform: data.platform,
        length: data.length,
        topic: data.topic,
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
      await api.saveVideoScript({
        brandId,
        topic: result.topic,
        platform: result.platform,
        length: result.length,
        scriptContent: result.videoPackage,
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
    const text = videoPackageToText(result.videoPackage, {
      platform: result.platform,
      length: result.length,
      topic: result.topic,
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
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Video topic or goal
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. How our service saves small businesses 10 hours a week"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Target platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Video length
            </label>
            <select
              value={length}
              onChange={(e) => setLength(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {LENGTHS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
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
          Creating your video package…
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

          <VideoPackageView
            pkg={result.videoPackage}
            platform={result.platform}
            length={result.length}
            topic={result.topic}
          />
        </div>
      )}
    </div>
  );
}
