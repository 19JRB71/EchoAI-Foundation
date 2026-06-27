// Shared Facebook OAuth connection UI used by both Settings and the onboarding
// wizard. Renders the official "Continue with Facebook" button (Facebook blue +
// logo), and once connected shows the ad-account picker, a green connected
// badge, and a disconnect button.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "./ErrorBanner.jsx";

const FB_BLUE = "#1877F2";

function FacebookLogo({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function ConnectButton({ full = false, onError }) {
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    if (onError) onError("");
    try {
      const { authUrl } = await api.startFacebookOAuth();
      window.location.href = authUrl;
    } catch (err) {
      if (onError) onError(err.message);
      setStarting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={starting}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60",
        full ? "w-full" : "",
      ].join(" ")}
      style={{ backgroundColor: FB_BLUE }}
    >
      <FacebookLogo />
      {starting ? "Redirecting…" : "Continue with Facebook"}
    </button>
  );
}

const STATUS_LABELS = {
  ACTIVE: "Active",
  1: "Active",
  2: "Disabled",
  3: "Unsettled",
  7: "Pending review",
  9: "In grace period",
  101: "Closed",
};

function accountStatusLabel(status) {
  if (status == null) return null;
  return STATUS_LABELS[status] || `Status ${status}`;
}

export default function FacebookConnect({ onChange }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getFacebookAccounts();
      setState(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Surface a result of the OAuth redirect (?fb=connected|error) once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fb = params.get("fb");
    if (!fb) return;
    if (fb === "error") {
      setError(params.get("fb_message") || "Facebook connection failed.");
    }
    // Clean the query so the message doesn't persist across navigation.
    params.delete("fb");
    params.delete("fb_message");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
  }, []);

  async function selectAccount(accountId) {
    setBusy(true);
    setError("");
    try {
      await api.selectFacebookAccount(accountId);
      setState((s) => ({ ...s, selectedAccountId: accountId }));
      if (onChange) onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api.disconnectFacebook();
      await load();
      if (onChange) onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading Facebook connection…</p>;
  }

  const connected = state?.connected;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {!state?.configured && (
        <p className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Facebook connection isn't configured yet. Add your Facebook app
          credentials to enable it.
        </p>
      )}

      {connected ? (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-400" />
              Connected
            </span>
            <span className="text-sm text-gray-400">
              Your Facebook account is linked to EchoAI.
            </span>
          </div>

          {state.accounts.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">
                Ad account EchoAI manages
              </label>
              <select
                value={state.selectedAccountId || ""}
                disabled={busy}
                onChange={(e) => selectAccount(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {state.accounts.map((a) => {
                  const label = accountStatusLabel(a.accountStatus);
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.id})
                      {a.currency ? ` · ${a.currency}` : ""}
                      {label ? ` · ${label}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              No ad accounts were found on this Facebook account.
            </p>
          )}

          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="rounded-lg border border-red-700/50 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-60"
          >
            {busy ? "Working…" : "Disconnect Facebook"}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Connect your Facebook account so EchoAI can run and optimize your ad
            campaigns. You'll authorize EchoAI securely through Facebook — no
            tokens to copy or paste.
          </p>
          {state?.configured && <ConnectButton onError={setError} />}
        </div>
      )}
    </div>
  );
}
