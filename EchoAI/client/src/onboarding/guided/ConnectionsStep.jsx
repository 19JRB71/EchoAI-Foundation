// "Connect your accounts" — card per connection, driven entirely by the
// server's LIVE probes (never fabricated): Connected / Not connected / a
// neutral "can't check right now" when a probe failed. Every connection is
// individually skippable, every failure gets plain-English translation with
// Try Again / Help Me / Skip for Now.

import { useState } from "react";
import { CONNECTION_CATALOG } from "./connectionCatalog.jsx";
import { translateConnectionError, errorCopyForKey } from "./connectionErrors.js";
import PreviewPanel from "./PreviewPanel.jsx";
import HelpMeRescue from "./HelpMeRescue.jsx";

export default function ConnectionsStep({
  statuses,
  flags,
  updateFlags,
  speak,
  notice,
  onDismissNotice,
  onNext,
  onBack,
}) {
  const [previewFor, setPreviewFor] = useState(null); // connection key
  const [helpFor, setHelpFor] = useState(null); // connection key
  const [busyKey, setBusyKey] = useState(null);
  // Initiate failures (e.g. connections not configured) — local, per key.
  const [localErrors, setLocalErrors] = useState({});

  function openPreview(connection) {
    setPreviewFor(connection.key);
    if (speak) speak(connection.previewInstruction);
  }

  async function startConnect(connection) {
    if (busyKey) return;
    setBusyKey(connection.key);
    setLocalErrors((prev) => ({ ...prev, [connection.key]: null }));
    try {
      // Persist "connecting" + clear any old error BEFORE leaving the page, so
      // the wizard resumes on this step after the full-page OAuth redirect.
      await updateFlags(connection.key, { connecting: true, errorKey: null, skipped: false });
      const { authUrl } = await connection.start();
      window.location.href = authUrl;
      // navigating away — leave busy so the button stays disabled
    } catch (err) {
      setBusyKey(null);
      setPreviewFor(null);
      setLocalErrors((prev) => ({
        ...prev,
        [connection.key]: translateConnectionError(connection.key, err.message),
      }));
      updateFlags(connection.key, { connecting: false }).catch(() => {});
    }
  }

  async function skip(connection) {
    await updateFlags(connection.key, { skipped: true, connecting: false, errorKey: null });
    setLocalErrors((prev) => ({ ...prev, [connection.key]: null }));
  }

  const previewConnection = CONNECTION_CATALOG.find((c) => c.key === previewFor);
  const helpConnection = CONNECTION_CATALOG.find((c) => c.key === helpFor);

  return (
    <div>
      {notice && (
        <div
          className={[
            "mb-5 flex items-start justify-between gap-3 rounded-2xl border p-4",
            notice.tone === "success"
              ? "border-emerald-500/25 bg-emerald-500/10"
              : "border-amber-500/25 bg-amber-500/10",
          ].join(" ")}
        >
          <p
            className={[
              "text-sm leading-relaxed",
              notice.tone === "success" ? "text-emerald-100" : "text-amber-100",
            ].join(" ")}
          >
            {notice.text}
          </p>
          <button
            type="button"
            onClick={onDismissNotice}
            aria-label="Dismiss"
            className="shrink-0 text-sm font-semibold text-gray-400 hover:text-gray-200"
          >
            ✕
          </button>
        </div>
      )}

      <h2 className="text-2xl font-extrabold text-gray-100">Connect your accounts</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        Each one you connect lets Echo do more for you automatically. All of them are optional —
        you can skip any and connect it later from Settings.
      </p>

      <div className="mt-6 space-y-4">
        {CONNECTION_CATALOG.map((connection) => {
          const status = statuses?.[connection.key] || "unknown";
          const flag = flags?.[connection.key] || {};
          const error =
            localErrors[connection.key] ||
            (status !== "connected" && flag.errorKey
              ? errorCopyForKey(connection.key, flag.errorKey)
              : null);
          return (
            <ConnectionCard
              key={connection.key}
              connection={connection}
              status={status}
              flag={flag}
              error={error}
              busy={busyKey === connection.key}
              onConnect={() => openPreview(connection)}
              onSkip={() => skip(connection)}
              onHelp={() => setHelpFor(connection.key)}
            />
          );
        })}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600"
        >
          Continue
        </button>
      </div>

      {previewConnection && (
        <PreviewPanel
          connection={previewConnection}
          busy={busyKey === previewConnection.key}
          onCancel={() => setPreviewFor(null)}
          onContinue={() => startConnect(previewConnection)}
        />
      )}

      {helpConnection && (
        <HelpMeRescue
          context={`connecting ${helpConnection.name}`}
          speak={speak}
          onClose={() => setHelpFor(null)}
        />
      )}
    </div>
  );
}

function ConnectionCard({ connection, status, flag, error, busy, onConnect, onSkip, onHelp }) {
  const { name, benefit, Logo } = connection;
  const connected = status === "connected";
  const unknown = status === "unknown";

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start gap-4">
        <Logo className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-gray-100">{name}</h3>
            {connected && (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                ✓ Connected
              </span>
            )}
            {!connected && unknown && (
              <span className="rounded-full bg-gray-700/60 px-2.5 py-0.5 text-xs font-semibold text-gray-300">
                Can&apos;t check right now
              </span>
            )}
            {!connected && !unknown && flag.skipped && (
              <span className="rounded-full bg-gray-700/60 px-2.5 py-0.5 text-xs font-semibold text-gray-400">
                Skipped for now
              </span>
            )}
            {!connected && error && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                Needs attention
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">{benefit}</p>

          {!connected && error && (
            <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold text-amber-200">{error.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-100/90">{error.body}</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-100/90">{error.action}</p>
            </div>
          )}
        </div>
      </div>

      {!connected && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? "Opening…" : error ? "Try again" : flag.skipped ? "Connect after all" : `Connect ${name}`}
          </button>
          {error && (
            <button
              type="button"
              onClick={onHelp}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800"
            >
              Help me
            </button>
          )}
          {!flag.skipped && (
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-gray-800"
            >
              Skip for now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
