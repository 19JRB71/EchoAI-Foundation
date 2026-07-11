// Step 2 — Facebook account connection.
// Walks the customer through connecting their Facebook ad account via OAuth.
// Connecting is optional here — they can skip and finish it later from Settings.

import { useEffect, useState } from "react";
import { api } from "../../api.js";
import FacebookConnect from "../../components/FacebookConnect.jsx";

const primaryBtn =
  "rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const ghostBtn =
  "rounded-lg px-5 py-2.5 text-sm font-semibold text-gray-400 hover:text-gray-200";
const backBtn =
  "rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800";

export default function StepFacebook({ onNext, onBack, onConnected }) {
  const [connected, setConnected] = useState(false);

  // Reflect the live connection status (e.g. after returning from the OAuth
  // redirect) so the wizard can show "Continue" instead of "Skip".
  useEffect(() => {
    let active = true;
    api
      .getFacebookAccounts()
      .then((data) => {
        if (active && data.connected) {
          setConnected(true);
          if (onConnected) onConnected();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [onConnected]);

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-gray-100">
        Connect your Facebook ad account
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-400">
        Zorecho runs your campaigns directly inside your own Facebook Ads account,
        so you always stay in full control of your budget and data. Authorize
        Zorecho securely through Facebook — there are no tokens to copy or paste.
      </p>

      <div className="mt-6">
        <FacebookConnect
          onChange={() => {
            setConnected(true);
            if (onConnected) onConnected();
          }}
        />
      </div>

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
