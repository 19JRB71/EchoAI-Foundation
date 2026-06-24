// Step 2 — Facebook account connection.
// Walks the customer through connecting their Facebook ad account. Connecting
// is optional here — they can skip and finish it later from Settings.

import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const primaryBtn =
  "rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60";
const ghostBtn =
  "rounded-lg px-5 py-2.5 text-sm font-semibold text-gray-500 hover:text-gray-700";
const backBtn =
  "rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50";

export default function StepFacebook({ onNext, onBack, onConnected }) {
  const [adAccountId, setAdAccountId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  async function connect(e) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    try {
      await api.connectFacebook(adAccountId.trim());
      setConnected(true);
      if (onConnected) onConnected();
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">
        Connect your Facebook ad account
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        EchoAI runs your campaigns directly inside your own Facebook Ads account,
        so you always stay in full control of your budget and data.
      </p>

      <ol className="mt-5 space-y-2 text-sm text-gray-600">
        <li>
          <span className="font-semibold text-gray-800">1.</span> Open{" "}
          <span className="font-medium">Meta Ads Manager</span> and go to{" "}
          <span className="font-medium">Account Settings</span>.
        </li>
        <li>
          <span className="font-semibold text-gray-800">2.</span> Copy your{" "}
          <span className="font-medium">Ad account ID</span> (it looks like{" "}
          <code className="rounded bg-gray-100 px-1">act_123456789</code>).
        </li>
        <li>
          <span className="font-semibold text-gray-800">3.</span> Paste it below
          and connect — you'll authorize EchoAI through Facebook.
        </li>
      </ol>

      {connected ? (
        <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm font-medium text-green-700">
          ✓ Facebook ad account connected successfully.
        </div>
      ) : (
        <form onSubmit={connect} className="mt-6 space-y-3">
          <input
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value)}
            placeholder="act_123456789"
            required
            className={inputClass}
          />
          <ErrorBanner message={error} />
          <button disabled={connecting} className={primaryBtn}>
            {connecting ? "Connecting…" : "Connect with Facebook"}
          </button>
        </form>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={onBack} className={backBtn}>
          Back
        </button>
        {connected ? (
          <button type="button" onClick={onNext} className={primaryBtn}>
            Continue
          </button>
        ) : (
          <button type="button" onClick={onNext} className={ghostBtn}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
