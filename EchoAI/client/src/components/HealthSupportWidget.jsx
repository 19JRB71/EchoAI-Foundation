// Floating "Help & Support" widget shown on every dashboard page, sitting just
// above the "Take the Tour" button. Two tabs:
//   - Report an Issue: capture the current screen (Screen Capture API, with a
//     file-upload fallback for browsers/iframes that block it), add a
//     description, and send it to the AI Screenshot Support agent.
//   - Health Status: the brand's latest AI Health Monitor result (colored dot,
//     plain-English analysis, and any issues needing attention).

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";

const STATUS_META = {
  critical: { color: "#ef4444", label: "Action needed", ring: "shadow-red-500/40" },
  warning: { color: "#f59e0b", label: "Minor issues", ring: "shadow-amber-500/40" },
  healthy: { color: "#22c55e", label: "All systems healthy", ring: "shadow-green-500/40" },
  unknown: { color: "#6b7280", label: "Not checked yet", ring: "shadow-gray-500/30" },
};

// Downscale + JPEG-encode a captured image so the payload stays well under the
// server's 8 MB limit even on large screens.
function fileToScaledDataUrl(source, maxWidth = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = source;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function StatusDot({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: meta.color }}
      title={meta.label}
    />
  );
}

function ReportIssueTab({ brandId, isPublic }) {
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  async function captureScreen() {
    setError("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen capture isn't available here — upload an image instead.");
      fileInputRef.current?.click();
      return;
    }
    setCapturing(true);
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      // Give the frame a moment to paint before grabbing it.
      await new Promise((r) => setTimeout(r, 250));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const dataUrl = await fileToScaledDataUrl(canvas.toDataURL("image/png"));
      setScreenshot(dataUrl);
    } catch {
      setError("Screen capture was cancelled or blocked. You can upload an image instead.");
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setCapturing(false);
    }
  }

  async function onFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const scaled = await fileToScaledDataUrl(dataUrl);
      setScreenshot(scaled);
    } catch {
      setError("Couldn't read that image. Please try a different file.");
    } finally {
      e.target.value = "";
    }
  }

  async function submit() {
    setError("");
    if (!screenshot && !description.trim()) {
      setError("Add a screenshot or describe what you're seeing.");
      return;
    }
    setSending(true);
    try {
      const payload = { description: description.trim(), screenshot };
      const ticket = isPublic
        ? await api.submitPublicSupportTicket(payload)
        : await api.submitSupportTicket({ ...payload, brandId });
      setResult(ticket);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (result) {
    const a = result.ai_analysis || {};
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-300">
          Thanks — our AI support agent reviewed your issue.
        </div>
        {a.summary && <p className="text-sm font-semibold text-gray-100">{a.summary}</p>}
        {a.diagnosis && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">What's happening</p>
            <p className="mt-1 text-sm text-gray-300">{a.diagnosis}</p>
          </div>
        )}
        {a.resolution && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">What to do</p>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-300">{a.resolution}</p>
          </div>
        )}
        <button
          onClick={() => {
            setResult(null);
            setScreenshot(null);
            setDescription("");
          }}
          className="text-sm font-semibold text-teal-400 hover:underline"
        >
          Report another issue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        Capture your screen (or upload an image) and tell us what's wrong. Our AI
        support agent will look at it and help right away.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={captureScreen}
          disabled={capturing}
          className="rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-teal-400 disabled:opacity-60"
        >
          {capturing ? "Capturing…" : "Capture my screen"}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
        >
          Upload image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFilePicked}
        />
      </div>

      {screenshot && (
        <div className="relative">
          <img
            src={screenshot}
            alt="Screenshot preview"
            className="max-h-40 w-full rounded-lg border border-gray-700 object-contain"
          />
          <button
            onClick={() => setScreenshot(null)}
            className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-gray-200 hover:bg-black"
          >
            Remove
          </button>
        </div>
      )}

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="Describe what you're seeing or what you expected to happen…"
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-teal-500 focus:outline-none"
      />

      {error && (
        <div className="rounded-lg bg-red-500/10 p-2 text-sm text-red-300">{error}</div>
      )}

      <button
        onClick={submit}
        disabled={sending}
        className="w-full rounded-lg bg-teal-500 py-2.5 text-sm font-semibold text-gray-900 hover:bg-teal-400 disabled:opacity-60"
      >
        {sending ? "Sending…" : "Send to AI support"}
      </button>
    </div>
  );
}

function HealthStatusTab({ brandId }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    try {
      const data = await api.healthGetStatus(brandId);
      setStatus(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runNow() {
    setError("");
    setRunning(true);
    try {
      const record = await api.healthRunCheck(brandId);
      setStatus({
        overallStatus: record.overall_status,
        lastCheck: record.check_time,
        aiAnalysis: record.ai_analysis,
        issuesRequiringAttention: record.issues_requiring_attention || [],
      });
    } catch (err) {
      setError(err.message || "Couldn't run the health check.");
    } finally {
      setRunning(false);
    }
  }

  if (!brandId) {
    return <p className="text-sm text-gray-400">Select a brand to see its health status.</p>;
  }
  if (loading) return <p className="text-sm text-gray-400">Checking…</p>;

  const s = status?.overallStatus || "unknown";
  const meta = STATUS_META[s] || STATUS_META.unknown;
  const issues = status?.issuesRequiringAttention || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusDot status={s} />
        <span className="text-sm font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      {status?.lastCheck && (
        <p className="text-xs text-gray-500">
          Last checked {new Date(status.lastCheck).toLocaleString()}
        </p>
      )}
      {status?.aiAnalysis && (
        <p className="whitespace-pre-line text-sm text-gray-300">{status.aiAnalysis}</p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((i, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-gray-800 bg-gray-900 p-2 text-sm"
            >
              <span
                className="mr-1 font-semibold"
                style={{ color: (STATUS_META[i.severity] || STATUS_META.unknown).color }}
              >
                {i.system}:
              </span>
              <span className="text-gray-300">{i.message}</span>
              {i.detail && <p className="mt-0.5 text-xs text-gray-500">{i.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="rounded-lg bg-red-500/10 p-2 text-sm text-red-300">{error}</div>
      )}
      <button
        onClick={runNow}
        disabled={running}
        className="w-full rounded-lg border border-gray-700 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-60"
      >
        {running ? "Running check…" : "Run a health check now"}
      </button>
    </div>
  );
}

export default function HealthSupportWidget({ brandId, isPublic = false }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("report");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed right-5 z-[900] flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2.5 text-sm font-semibold text-gray-100 shadow-lg transition hover:bg-gray-700 ${
          isPublic ? "bottom-5" : "bottom-24"
        }`}
        aria-label="Help and support"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093v.5M12 17h.01"
          />
          <circle cx="12" cy="12" r="9" />
        </svg>
        Help &amp; Support
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-end p-4 sm:items-center sm:justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-100">Help &amp; Support</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex gap-1 rounded-lg bg-gray-900 p-1">
              <button
                onClick={() => setTab("report")}
                className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition ${
                  tab === "report" ? "bg-teal-500 text-gray-900" : "text-gray-300 hover:text-white"
                }`}
              >
                Report an Issue
              </button>
              {!isPublic && (
                <button
                  onClick={() => setTab("health")}
                  className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition ${
                    tab === "health" ? "bg-teal-500 text-gray-900" : "text-gray-300 hover:text-white"
                  }`}
                >
                  Health Status
                </button>
              )}
            </div>

            {tab === "report" ? (
              <ReportIssueTab brandId={brandId} isPublic={isPublic} />
            ) : (
              <HealthStatusTab brandId={brandId} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

export { StatusDot };
