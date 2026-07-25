// Google OAuth connection UI. Mirrors FacebookConnect: a "Continue with Google"
// button, a connected badge with the linked account email, per-service status,
// and a disconnect button. Config-gated — shows a "not configured" notice when
// the server has no Google OAuth credentials.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { openAuthUrl } from "../lib/oauthNav.js";
import ErrorBanner from "./ErrorBanner.jsx";

const SERVICE_LABELS = {
  businessProfile: "Business Profile",
  googleAds: "Google Ads",
  googleAnalytics: "Analytics",
  searchConsole: "Search Console",
};

function GoogleLogo({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 002.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function ConnectButton({ full = false, onError }) {
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    if (onError) onError("");
    try {
      const { authUrl } = await api.startGoogleOAuth();
      if (!openAuthUrl(authUrl)) setStarting(false);
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
        "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60",
        full ? "w-full" : "",
      ].join(" ")}
    >
      <GoogleLogo />
      {starting ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}

export default function GoogleConnect({ onChange }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setState(await api.getGoogleStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Surface the OAuth redirect result (?google=connected|error) once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (!g) return;
    if (g === "error") {
      setError(params.get("google_message") || "Google connection failed.");
    }
    params.delete("google");
    params.delete("google_message");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
  }, []);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api.disconnectGoogle();
      await load();
      if (onChange) onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading Google connection…</p>;
  }

  const connected = state?.connected;
  const services = state?.services || {};

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {!state?.configured && (
        <p className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Google connection isn't configured yet. Add your Google OAuth client
          credentials (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) to enable it.
        </p>
      )}

      {connected ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-400" />
              Connected
            </span>
            {state.email && (
              <span className="text-sm text-gray-400">{state.email}</span>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(SERVICE_LABELS).map(([key, label]) => {
              const ok = services[key];
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm"
                >
                  <span className="text-gray-300">{label}</span>
                  <span
                    className={
                      ok ? "text-xs font-semibold text-green-400" : "text-xs text-gray-500"
                    }
                  >
                    {ok ? "Authorized" : "Not granted"}
                  </span>
                </div>
              );
            })}
          </div>

          {state.adsConfigured === false && services.googleAds && (
            <p className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Google Ads is authorized, but ad reporting also requires a Google Ads
              developer token on the server.
            </p>
          )}

          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="rounded-lg border border-red-700/50 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-60"
          >
            {busy ? "Working…" : "Disconnect Google"}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Connect your Google account so Zorecho can read your Business Profile,
            Ads, Analytics, and Search Console data. You'll authorize Zorecho
            securely through Google — no tokens to copy or paste.
          </p>
          {state?.configured && <ConnectButton onError={setError} />}
        </div>
      )}
    </div>
  );
}
