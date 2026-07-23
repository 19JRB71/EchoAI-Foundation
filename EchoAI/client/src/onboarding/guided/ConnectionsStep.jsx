// "Connect your accounts" — card per connection, driven entirely by the
// server's LIVE probes (never fabricated): Connected / Not connected / a
// neutral "can't check right now" when a probe failed. Every connection is
// individually skippable, every failure gets plain-English translation with
// Try Again / Help Me / Skip for Now.

import { useState } from "react";
import { api } from "../../api.js";
import { openAuthUrl } from "../../lib/oauthNav.js";
import { CONNECTION_CATALOG } from "./connectionCatalog.jsx";
import { translateConnectionError, errorCopyForKey } from "./connectionErrors.js";
import PreviewPanel from "./PreviewPanel.jsx";
import HelpMeRescue from "./HelpMeRescue.jsx";

// Milestone framing (Customer Experience Constitution): each connection is
// presented as unlocking an ability, not filling out a form.
const MILESTONE_EYEBROW = {
  facebook: "Milestone 2 · Unlock automation",
  google: "Milestone 2 · Unlock automation",
  email: "Milestone 3 · Never miss a lead",
};

const MILESTONE_UNLOCKS = {
  facebook:
    "Unlocks: automatic posting, Facebook ads, and Nova working for you around the clock.",
  google:
    "Unlocks: calendar scheduling, Gmail monitoring, and appointment booking.",
  email:
    "Unlocks: Echo watches your business inbox and flags leads before they go cold.",
};

export default function ConnectionsStep({
  statuses,
  readiness,
  verification,
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
      // When embedded (staging preview iframe) OAuth opens in a new tab —
      // Google/Facebook refuse to render inside a frame. The wizard resumes
      // on this step there thanks to the persisted "connecting" flag.
      const navigatedAway = openAuthUrl(authUrl);
      if (!navigatedAway) setBusyKey(null);
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

      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
        Milestones 2 &amp; 3 · Unlock your AI team
      </p>
      <h2 className="mt-1 text-2xl font-extrabold text-gray-100">
        To automate this, I need your accounts.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        Each one you connect unlocks another ability — you&apos;re not filling out forms,
        you&apos;re turning on your AI team. All of them are optional and can be done later.
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
              ready={readiness ? readiness[connection.key] !== false : undefined}
              verified={verification ? verification[connection.key] !== false : undefined}
              busy={busyKey === connection.key}
              onConnect={() => openPreview(connection)}
              onSkip={() => skip(connection)}
              onHelp={() => setHelpFor(connection.key)}
            />
          );
        })}

        <EmailConnectCard
          status={statuses?.email || "unknown"}
          flag={flags?.email || {}}
          updateFlags={updateFlags}
          speak={speak}
        />
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

function ConnectionCard({ connection, status, flag, error, busy, ready, verified, onConnect, onSkip, onHelp }) {
  const { name, benefit, Logo } = connection;
  const connected = status === "connected";
  const unknown = status === "unknown";
  // "No green button without a green backend": the server said this
  // provider's credentials are missing, so a Connect attempt cannot succeed.
  const setupRequired = !connected && ready === false;
  // Credentials are configured, but no full authorization round trip has
  // ever succeeded on this system — be honest that it's still unproven.
  const awaitingVerification = !connected && ready !== false && verified === false;

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start gap-4">
        <Logo className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          {MILESTONE_EYEBROW[connection.key] && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-300/80">
              {MILESTONE_EYEBROW[connection.key]}
            </p>
          )}
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
            {setupRequired && (
              <span className="rounded-full bg-gray-700/60 px-2.5 py-0.5 text-xs font-semibold text-gray-300">
                Setup required
              </span>
            )}
            {awaitingVerification && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                Configured but awaiting verification
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">{benefit}</p>
          {MILESTONE_UNLOCKS[connection.key] && (
            <p className="mt-1 text-xs font-medium text-emerald-300/80">
              {MILESTONE_UNLOCKS[connection.key]}
            </p>
          )}

          {!connected && error && (
            <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold text-amber-200">{error.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-100/90">{error.body}</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-100/90">{error.action}</p>
            </div>
          )}
        </div>
      </div>

      {!connected && setupRequired && (
        <div className="mt-4">
          <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-3">
            <p className="text-sm font-semibold text-gray-200">Setup required</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-400">
              {name} isn&apos;t available on this system yet — the administrator
              hasn&apos;t finished configuring it. You can skip this for now and
              connect later; nothing else is blocked.
            </p>
          </div>
          {!flag.skipped && (
            <button
              type="button"
              onClick={onSkip}
              className="mt-3 rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-gray-800"
            >
              Skip for now
            </button>
          )}
        </div>
      )}

      {!connected && !setupRequired && (
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

// ---------------------------------------------------------------------------
// Milestone 3 — "Never Miss a Lead": connect the business mailbox with an app
// password (no OAuth redirect; the form is embedded right here). Status comes
// from the server's live probe of email_accounts.

function EmailLogo({ className = "h-10 w-10" }) {
  return (
    <span
      className={`${className} flex items-center justify-center rounded-full bg-sky-600 text-xl`}
      aria-hidden="true"
    >
      ✉️
    </span>
  );
}

function EmailConnectCard({ status, flag, updateFlags, speak }) {
  const [open, setOpen] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justConnected, setJustConnected] = useState(false);

  const connected = status === "connected" || justConnected;
  const unknown = status === "unknown" && !justConnected;

  async function connect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.connectEmailAccount({
        emailAddress: emailAddress.trim(),
        password: password.trim(),
      });
      setJustConnected(true);
      setOpen(false);
      updateFlags("email", { skipped: false, errorKey: null, connecting: false });
      if (speak) speak("I'm now watching your inbox, Sir. No lead slips past me.");
    } catch (err) {
      setError(
        err.message ||
          "That didn't work — double-check the email address and app password, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start gap-4">
        <EmailLogo className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-300/80">
            {MILESTONE_EYEBROW.email}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-gray-100">Business email</h3>
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
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            Connect the mailbox where customers reach you, and Echo reads it every 15
            minutes — flagging leads, urgent messages, and things that need your reply.
          </p>
          <p className="mt-1 text-xs font-medium text-emerald-300/80">{MILESTONE_UNLOCKS.email}</p>

          {connected && justConnected && (
            <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
              <p className="text-sm leading-relaxed text-emerald-100">
                I&apos;m now watching your inbox, Sir. No lead slips past me.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
              <p className="text-sm leading-relaxed text-amber-100">{error}</p>
            </div>
          )}

          {!connected && open && (
            <div className="mt-3 space-y-3">
              <p className="text-xs leading-relaxed text-gray-500">
                Use an app password (not your normal password) — in Gmail or Outlook,
                search settings for &quot;app password&quot; to create one.
              </p>
              <input
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="you@yourbusiness.com"
                type="email"
              />
              <input
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="App password"
                type="password"
              />
            </div>
          )}
        </div>
      </div>

      {!connected && (
        <div className="mt-4 flex flex-wrap gap-3">
          {open ? (
            <>
              <button
                type="button"
                onClick={connect}
                disabled={busy || !emailAddress.trim() || !password.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? "Checking the mailbox…" : "Connect my inbox"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError("");
                }}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-gray-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600"
              >
                {flag.skipped ? "Connect after all" : "Connect email"}
              </button>
              {!flag.skipped && (
                <button
                  type="button"
                  onClick={() =>
                    updateFlags("email", { skipped: true, connecting: false, errorKey: null })
                  }
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-gray-800"
                >
                  Skip for now
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
