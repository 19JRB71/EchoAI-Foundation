import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { PLATFORMS, PlatformBadge, platformMeta } from "./platformMeta.jsx";

export default function ConnectedAccounts({ brandId }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(null); // platform key or null

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getSocialAccounts(brandId);
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const byPlatform = Object.fromEntries(accounts.map((a) => [a.platform, a]));

  async function handleDisconnect(platform) {
    setError("");
    try {
      await api.disconnectSocial(brandId, platform);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading accounts…" />
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          {PLATFORMS.map((platform) => {
            const meta = platformMeta(platform);
            const account = byPlatform[platform];
            const connected = Boolean(account);
            const hasError = account && account.status === "error";
            return (
              <div key={platform} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <PlatformBadge platform={platform} size={32} />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {meta.label}
                      </p>
                      {connected ? (
                        <p className="text-xs text-gray-500">
                          {account.username || "Connected"}
                          {hasError && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              needs attention
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400">Not connected</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {connected ? (
                      <button
                        onClick={() => handleDisconnect(platform)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setConnecting(connecting === platform ? null : platform)
                        }
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                      >
                        {connecting === platform ? "Cancel" : "Connect"}
                      </button>
                    )}
                  </div>
                </div>

                {connecting === platform && (
                  <ConnectForm
                    brandId={brandId}
                    platform={platform}
                    onConnected={async () => {
                      setConnecting(null);
                      await load();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectForm({ brandId, platform, onConnected }) {
  const meta = platformMeta(platform);
  const [values, setValues] = useState({});
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function setField(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const missing = meta.fields
      .filter((f) => f.required && !values[f.key])
      .map((f) => f.label);
    if (missing.length) {
      setError(`Missing: ${missing.join(", ")}`);
      setBusy(false);
      return;
    }
    try {
      await api.connectSocial({
        brandId,
        platform,
        credentials: values,
        username: username || undefined,
      });
      await onConnected();
    } catch (err) {
      // The backend stores the credentials but returns 502 when verification
      // fails — the account exists in a "needs attention" state, so reload the
      // list (it will show the amber badge) rather than treating it as a no-op.
      if (err.status === 502) {
        await onConnected();
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-3 rounded-lg bg-gray-50 p-4"
    >
      {meta.fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {field.label}
          </label>
          <input
            type="text"
            value={values[field.key] || ""}
            onChange={(e) => setField(field.key, e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      ))}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Display username (optional)
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Connecting…" : `Connect ${meta.label}`}
      </button>
    </form>
  );
}
