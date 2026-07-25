// "Help Me" screenshot rescue for stuck customers.
//
// Flow: explicit consent notice → screenshot upload → Echo's vision analysis
// (server: /api/guided-setup/help) → the answer shown on screen and spoken.
// Low confidence or AI failure is handled HONESTLY: Echo says it isn't sure
// and offers to send the screenshot to a human via the existing support
// pipeline — it never guesses.

import { useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // matches the server-side cap

export default function HelpMeRescue({ context, speak, onClose }) {
  // consent → upload → analyzing → result | unsure → escalated
  const [phase, setPhase] = useState("consent");
  const [dataUrl, setDataUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [unsureMessage, setUnsureMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function pickFile(e) {
    setError("");
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setError("That doesn't look like an image — please choose a screenshot.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That screenshot is too large. Please try a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result || ""));
    reader.onerror = () => setError("Couldn't read that file — please try again.");
    reader.readAsDataURL(file);
  }

  async function analyze() {
    if (!dataUrl || busy) return;
    setBusy(true);
    setError("");
    setPhase("analyzing");
    try {
      const res = await api.guidedSetupHelp({ screenshot: dataUrl, context });
      if (res.confidence === "low") {
        // Honest: don't present a low-confidence guess as guidance.
        setUnsureMessage(
          "I looked at your screenshot but I'm honestly not sure what screen that is, and I'd rather not guess.",
        );
        setPhase("unsure");
      } else {
        setResult(res);
        setPhase("result");
        if (speak) speak(`${res.screen} ${res.nextAction}`);
      }
    } catch (err) {
      // AI unavailable (502) or any other failure → honest rescue, never a guess.
      setUnsureMessage(
        err.status === 502
          ? "I couldn't read that screenshot right now."
          : err.message || "Something went wrong while I was looking at your screenshot.",
      );
      setPhase("unsure");
    } finally {
      setBusy(false);
    }
  }

  async function escalate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.submitSupportTicket({
        description: `Guided setup — customer got stuck while ${context || "setting up"} and asked for help.`,
        screenshot: dataUrl,
      });
      setPhase("escalated");
    } catch (err) {
      setError(err.message || "Couldn't reach support just now — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const secondaryBtn =
    "rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50";
  const primaryBtn =
    "rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Help me — screenshot rescue"
    >
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-gray-100">Let me take a look</h3>

        {phase === "consent" && (
          <>
            <p className="mt-3 text-sm leading-relaxed text-gray-300">
              Take a screenshot of what you&apos;re seeing right now and upload it — I&apos;ll tell
              you exactly what to click next.
            </p>
            <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
              Before you upload: your screenshot will be sent to Echo to analyze. Please make sure
              it doesn&apos;t show anything private you wouldn&apos;t want shared — like passwords,
              bank details, or personal messages.
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={onClose} className={secondaryBtn}>
                Cancel
              </button>
              <button type="button" onClick={() => setPhase("upload")} className={primaryBtn}>
                I understand — continue
              </button>
            </div>
          </>
        )}

        {phase === "upload" && (
          <>
            <p className="mt-3 text-sm text-gray-300">Choose your screenshot:</p>
            <input
              type="file"
              accept="image/*"
              onChange={pickFile}
              className="mt-3 block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gray-100 hover:file:bg-gray-600"
            />
            {dataUrl && (
              <img
                src={dataUrl}
                alt="Your screenshot, ready to send"
                className="mt-4 max-h-56 w-full rounded-xl border border-gray-800 object-contain"
              />
            )}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={analyze}
                disabled={!dataUrl || busy}
                className={primaryBtn}
              >
                Send to Echo
              </button>
            </div>
          </>
        )}

        {phase === "analyzing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Spinner label="Echo is looking at your screenshot…" />
          </div>
        )}

        {phase === "result" && result && (
          <>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  What you&apos;re looking at
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-200">{result.screen}</p>
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-400">
                  What to do next
                </p>
                <p className="mt-1 text-sm leading-relaxed text-emerald-100">{result.nextAction}</p>
              </div>
              {result.confidence === "medium" && (
                <p className="text-xs text-gray-500">
                  I&apos;m fairly sure about this — if it doesn&apos;t match what you see, send me
                  another screenshot or ask for a person.
                </p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDataUrl(null);
                  setResult(null);
                  setPhase("upload");
                }}
                className={secondaryBtn}
              >
                Send another screenshot
              </button>
              <button type="button" onClick={escalate} disabled={busy} className={secondaryBtn}>
                {busy ? "Sending…" : "Get a person to help"}
              </button>
              <button type="button" onClick={onClose} className={primaryBtn}>
                Got it
              </button>
            </div>
          </>
        )}

        {phase === "unsure" && (
          <>
            <p className="mt-3 text-sm leading-relaxed text-gray-300">
              {unsureMessage} Let&apos;s get you real help instead — I can send your screenshot to
              our support team right now.
            </p>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
                Close
              </button>
              {dataUrl && (
                <button type="button" onClick={escalate} disabled={busy} className={primaryBtn}>
                  {busy ? "Sending…" : "Send to support"}
                </button>
              )}
            </div>
          </>
        )}

        {phase === "escalated" && (
          <>
            <p className="mt-3 text-sm leading-relaxed text-gray-300">
              Done — your screenshot is with our support team and they&apos;ll take it from here.
              You can keep going with setup or skip this step for now.
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className={primaryBtn}>
                Back to setup
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
