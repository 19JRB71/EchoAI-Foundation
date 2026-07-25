import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { PlatformBadge, platformMeta } from "../social/platformMeta.jsx";
import VideoPackageView, {
  lengthLabel,
  videoPackageToText,
} from "./VideoPackageView.jsx";

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SavedScripts({ brandId, refreshKey }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getVideoScripts(brandId);
      setScripts(data.scripts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDelete(scriptId) {
    try {
      await api.deleteVideoScript(scriptId);
      setScripts((prev) => prev.filter((s) => s.script_id !== scriptId));
      if (selected && selected.script_id === scriptId) setSelected(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCopy(script) {
    const text = videoPackageToText(script.script_content, {
      platform: script.platform,
      length: script.video_length,
      topic: script.topic,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelected(null)}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
          >
            ← Back to saved scripts
          </button>
          <button
            onClick={() => handleCopy(selected)}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={() => handleDelete(selected.script_id)}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          <VideoPackageView
            pkg={selected.script_content}
            platform={selected.platform}
            length={selected.video_length}
            topic={selected.topic}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {loading ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Loading saved scripts…
        </div>
      ) : scripts.length === 0 ? (
        <p className="text-sm text-gray-400">
          No saved scripts yet. Generate one in the Script Generator and click
          Save Script.
        </p>
      ) : (
        <div className="space-y-3">
          {scripts.map((script) => {
            const meta = platformMeta(script.platform);
            const title = script.script_content?.title || script.topic;
            return (
              <div
                key={script.script_id}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm"
              >
                <button
                  onClick={() => setSelected(script)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <PlatformBadge platform={script.platform} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-100">
                      {title}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      {meta.label} · {lengthLabel(script.video_length)} ·{" "}
                      {formatDate(script.created_at)}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(script.script_id)}
                  className="shrink-0 rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
