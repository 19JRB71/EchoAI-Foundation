import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { PLATFORMS, PlatformBadge, platformMeta } from "./platformMeta.jsx";

// focusPlatform (optional): opens that platform's connect form immediately —
// used by the failed-post "Reconnect account" shortcut. onFocusConsumed lets
// the parent clear it so revisiting the tab later doesn't reopen the form.
export default function ConnectedAccounts({ brandId, focusPlatform, onFocusConsumed }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(focusPlatform || null); // platform key or null

  useEffect(() => {
    if (focusPlatform && onFocusConsumed) onFocusConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="divide-y divide-gray-800 overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
          {PLATFORMS.map((platform) => {
            const meta = platformMeta(platform);
            const account = byPlatform[platform];
            const connected = Boolean(account);
            const hasError = account && account.status === "error";
            const isFacebook = platform === "facebook";
            return (
              <div key={platform} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <PlatformBadge platform={platform} size={32} />
                    <div>
                      <p className="text-sm font-semibold text-gray-100">
                        {meta.label}
                      </p>
                      {connected ? (
                        <p className="text-xs text-gray-400">
                          {isFacebook ? "Posting as " : ""}
                          {account.username || "Connected"}
                          {hasError && (
                            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                              needs attention
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400">
                          {isFacebook ? "Not set up for posting" : "Not connected"}
                        </p>
                      )}
                      {isFacebook && (
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          Uses your one Facebook connection — just pick a Page.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {connected && (
                      <button
                        onClick={() => handleDisconnect(platform)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Disconnect
                      </button>
                    )}
                    {/* Connected accounts still get a Reconnect/Change button: an
                        expired/revoked token keeps the row "connected", and
                        re-selecting (Facebook) or re-entering credentials
                        (others) upserts them server-side. */}
                    <button
                      onClick={() =>
                        setConnecting(connecting === platform ? null : platform)
                      }
                      className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600"
                    >
                      {connecting === platform
                        ? "Cancel"
                        : isFacebook
                          ? connected
                            ? "Change Page"
                            : "Set up posting"
                          : connected
                            ? "Reconnect"
                            : "Connect"}
                    </button>
                  </div>
                </div>

                {connecting === platform &&
                  (isFacebook ? (
                    <FacebookPagePicker
                      brandId={brandId}
                      onConnected={async () => {
                        setConnecting(null);
                        await load();
                      }}
                    />
                  ) : (
                    <ConnectForm
                      brandId={brandId}
                      platform={platform}
                      onConnected={async () => {
                        setConnecting(null);
                        await load();
                      }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Facebook posting is wired from the single unified Facebook connection: rather
// than pasting a token + Page ID, the owner picks which of their already-connected
// Pages this brand should post to. If Facebook isn't connected yet, this offers
// the same one OAuth flow used everywhere else (no separate credential system).
function FacebookPagePicker({ brandId, onConnected }) {
  const [loading, setLoading] = useState(true);
  const [fb, setFb] = useState(null); // { configured, connected, pages, selectedPageId }
  const [pageId, setPageId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFb = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getFacebookAccounts();
      setFb(data);
      const pages = data.pages || [];
      setPageId(data.selectedPageId || (pages[0] && pages[0].id) || "");
    } catch (err) {
      setError(err.message);
      setFb(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFb();
  }, [loadFb]);

  async function startConnect() {
    setBusy(true);
    setError("");
    try {
      const { authUrl } = await api.startFacebookOAuth();
      if (authUrl) {
        window.location.href = authUrl;
        return;
      }
      setError("Could not start the Facebook connection. Please try again.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    // The Facebook connection is account-wide (one login serves every
    // business), so a disconnect resets it for ALL businesses — say so.
    const ok = window.confirm(
      "Disconnect Facebook? This resets the connection for ALL your businesses. " +
        "You'll reconnect fresh and pick which Pages to share on Facebook's screen.",
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await api.disconnectFacebook();
      await loadFb();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!pageId) {
      setError("Choose a Page to post from.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.setFacebookBrandPage({ brandId, pageId });
      await onConnected();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-4 rounded-lg bg-gray-800 p-4">
        <Spinner label="Checking your Facebook connection…" />
      </div>
    );
  }

  const configured = fb && fb.configured !== false;
  const connected = fb && fb.connected;
  const pages = (fb && fb.pages) || [];

  return (
    <div className="mt-4 space-y-3 rounded-lg bg-gray-800 p-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      )}

      {!configured ? (
        <p className="text-sm text-gray-300">
          Facebook isn’t configured on the server yet. Once it is, connect once
          here and every business can pick a Page to post from.
        </p>
      ) : !connected ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            Connect Facebook once — it authorizes all your Pages for both ads and
            posting. Then choose which Page this business posts to.
          </p>
          <button
            type="button"
            onClick={startConnect}
            disabled={busy}
            className="rounded-lg bg-[#1877F2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Opening Facebook…" : "Connect Facebook"}
          </button>
        </div>
      ) : pages.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            Facebook is connected, but we don’t see any Pages you manage. Make
            sure you granted access to your Page, then reconnect.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startConnect}
              disabled={busy}
              className="rounded-lg bg-[#1877F2] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Opening Facebook…" : "Reconnect Facebook"}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="rounded-lg border border-red-700/50 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            Which Facebook Page should this business post to?
          </p>
          <div className="space-y-2">
            {pages.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:border-amber-500"
              >
                <input
                  type="radio"
                  name="fb-page"
                  value={p.id}
                  checked={pageId === p.id}
                  onChange={() => setPageId(p.id)}
                />
                <span className="font-medium">{p.name || p.id}</span>
                {p.category && (
                  <span className="text-xs text-gray-400">· {p.category}</span>
                )}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Use this Page"}
            </button>
            <button
              type="button"
              onClick={startConnect}
              disabled={busy}
              className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
            >
              Reconnect Facebook
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="rounded-lg border border-red-700/50 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>
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
      className="mt-4 space-y-3 rounded-lg bg-gray-800 p-4"
    >
      {meta.fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            {field.label}
          </label>
          <input
            type="text"
            value={values[field.key] || ""}
            onChange={(e) => setField(field.key, e.target.value)}
            className="w-full rounded-lg border border-gray-700 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      ))}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-400">
          Display username (optional)
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-lg border border-gray-700 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
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
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
      >
        {busy ? "Connecting…" : `Connect ${meta.label}`}
      </button>
    </form>
  );
}
