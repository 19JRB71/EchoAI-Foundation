import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import BrandDiscovery from "./BrandDiscovery.jsx";
import Billing from "./billing/Billing.jsx";
import FacebookConnect from "../components/FacebookConnect.jsx";
import GoalEditorCard from "../components/GoalEditorCard.jsx";
import GeoTargetingCard from "../components/GeoTargetingCard.jsx";
import GoalAlertHistory from "../components/GoalAlertHistory.jsx";
import TeamManagement from "./team/TeamManagement.jsx";
import { tourTypeForTier } from "../tour/tourSteps.js";
import { HELP_CONTENT } from "../tour/helpContent.js";

const inputClass =
  "w-full rounded-lg border border-gray-700 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60";

export default function Settings({
  brandId,
  onBrandsChanged,
  initialTab = "account",
  focusGoals = null,
  openPaymentModal = false,
  workspaceRole = "owner",
  isTeamMember = false,
  isAdmin = false,
  tier = null,
}) {
  // Billing and team management are restricted to the workspace owner/admin.
  const canManage = workspaceRole === "owner" || workspaceRole === "admin";
  const [tab, setTab] = useState(initialTab);
  const goalsRef = useRef(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Deep link from Mission Control's goal-alert feed: land on the Account tab
  // and scroll to the Goals + Goal Alert History cards. focusGoals is a nonce
  // so repeated click-throughs re-scroll.
  useEffect(() => {
    if (!focusGoals) return;
    setTab("account");
    // Wait a frame so the account tab's cards are mounted before scrolling.
    const t = setTimeout(() => {
      if (goalsRef.current) {
        goalsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [focusGoals]);

  // Keep restricted users out of gated tabs even if deep-linked there.
  useEffect(() => {
    if (!canManage && (tab === "billing" || tab === "team")) setTab("account");
  }, [canManage, tab]);

  const tabBtn = (value, label) => (
    <button
      onClick={() => setTab(value)}
      className={[
        "rounded-lg px-4 py-2 text-sm font-semibold transition",
        tab === value
          ? "bg-amber-500 text-gray-900"
          : "border border-gray-700 text-gray-300 hover:bg-gray-800",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Settings</h2>
      <div className="flex flex-wrap gap-2">
        {tabBtn("account", "Account")}
        {canManage && tabBtn("billing", "Billing")}
        {canManage && tabBtn("team", "Team")}
        {tabBtn("tour", "Tour & Help")}
      </div>

      {tab === "billing" && canManage ? (
        <Billing openPaymentModal={openPaymentModal} />
      ) : tab === "team" && canManage ? (
        <TeamManagement isAdmin={isAdmin} />
      ) : tab === "tour" ? (
        <TourHelp tier={tier} isAdmin={isAdmin} />
      ) : (
        <div className="space-y-6">
          <SetupAgentCard />
          <ProfileCard isTeamMember={isTeamMember} />
          <FacebookCard />
          <TwilioCard brandId={brandId} />
          <BrandCard brandId={brandId} onBrandsChanged={onBrandsChanged} />
          <GeoTargetingCard brandId={brandId} />
          <div ref={goalsRef} className="space-y-6 scroll-mt-4">
            <GoalEditorCard brandId={brandId} />
            {(isAdmin || !isTeamMember) && (
              <GoalAlertHistory brandId={brandId} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Tour & Help tab: shows completion status for the user's tier-appropriate tour,
// a button to (re)start it, and an index of the contextual help available
// throughout the app.
function TourHelp({ tier, isAdmin }) {
  const tourType = isAdmin ? "admin" : tourTypeForTier(tier);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getTourStatus();
        if (active) setStatus((res.tours && res.tours[tourType]) || null);
      } catch {
        if (active) setStatus(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tourType]);

  function restartTour() {
    window.dispatchEvent(new Event("echoai:start-tour"));
  }

  const completed = status && status.completed;
  const helpKeys = Object.keys(HELP_CONTENT);

  return (
    <div className="space-y-6">
      <Card title="Guided product tour">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {loading ? (
              <span className="text-gray-400">Loading tour status…</span>
            ) : completed ? (
              <span className="inline-flex items-center gap-2 text-green-300">
                <span className="h-2 w-2 rounded-full bg-green-400" />
                Tour completed
                {status.completedAt
                  ? ` on ${new Date(status.completedAt).toLocaleDateString()}`
                  : ""}
              </span>
            ) : status ? (
              <span className="text-amber-300">
                Tour in progress — you're on step {(status.currentStep || 0) + 1}.
              </span>
            ) : (
              <span className="text-gray-400">You haven't taken the tour yet.</span>
            )}
            <p className="mt-1 text-xs text-gray-500">
              A guided walkthrough of every feature available on your plan.
            </p>
          </div>
          <button onClick={restartTour} className={primaryBtn}>
            {completed ? "Restart tour" : status ? "Resume tour" : "Start tour"}
          </button>
        </div>
      </Card>

      <Card title="Contextual help">
        <p className="mb-4 text-xs text-gray-500">
          Click the <span className="font-semibold text-gray-300">?</span> icon next
          to any section title for a quick explainer. Here's what each section does:
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {helpKeys.map((key) => {
            const h = HELP_CONTENT[key];
            return (
              <li
                key={key}
                className="rounded-lg border border-gray-800 bg-gray-950/40 p-3"
              >
                <div className="text-sm font-semibold text-gray-200">{h.title}</div>
                <div className="mt-0.5 text-xs text-gray-400">{h.what}</div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">{title}</h3>
      {children}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-300">
        {label}
      </label>
      {children}
    </div>
  );
}

// Brand fields can come back as strings OR structured objects/arrays (e.g.
// target_audience = { age, region }). Render them as readable text instead of
// letting an object reach JSX (which throws React error #31 and blanks the page).
function displayValue(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(displayValue).filter((p) => p && p !== "—");
    return parts.length ? parts.join(", ") : "—";
  }
  if (typeof value === "object") {
    const parts = Object.entries(value)
      .map(([k, v]) => {
        const inner = displayValue(v);
        return inner && inner !== "—" ? `${k}: ${inner}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : "—";
  }
  return String(value);
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-200">{displayValue(value)}</span>
    </div>
  );
}

// AI Setup Agent controls: a clearly-visible launcher for existing users (incl.
// admin, who predate the agent and never got the automatic greeting), plus a
// reset that clears setup history so the full new-user experience can be re-run.
function SetupAgentCard() {
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function launch() {
    window.dispatchEvent(new Event("echoai:open-setup-agent"));
  }

  async function reset() {
    setResetting(true);
    setError("");
    setNotice("");
    try {
      await api.resetSetupAgent();
      setNotice(
        "Setup agent status reset. Launch it again to go through the full new-user experience.",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card title="AI Setup Agent">
      <p className="mb-4 text-sm text-gray-400">
        Let the AI Setup Agent interview you and configure a whole brand
        workspace for you. You can launch it any time to set up a new brand.
      </p>
      {notice && <p className="mb-3 text-sm text-green-500">{notice}</p>}
      <ErrorBanner message={error} />
      <div className="flex flex-wrap gap-3">
        <button onClick={launch} className={primaryBtn}>
          Set up a new brand with AI
        </button>
        <button onClick={reset} disabled={resetting} className={secondaryBtn}>
          {resetting ? "Resetting…" : "Reset setup agent status"}
        </button>
      </div>
    </Card>
  );
}

function ProfileCard({ isTeamMember = false }) {
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getProfile();
        setProfile(data);
        setEmail(data.email || "");
        setPreferredName(data.preferredName || "");
        setTeamSize(data.teamSize != null ? String(data.teamSize) : "");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {};
      if (email && profile && email !== profile.email) payload.email = email;
      if (profile && preferredName !== (profile.preferredName || ""))
        payload.preferredName = preferredName;
      if (teamSize !== "") payload.teamSize = Number(teamSize);
      if (Object.keys(payload).length === 0) {
        setNotice("Nothing to update.");
        return;
      }
      const updated = await api.updateProfile(payload);
      setProfile(updated);
      setNotice("Profile updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <Card title="Profile">
        <Spinner label="Loading…" />
      </Card>
    );

  return (
    <Card title="Profile">
      <form onSubmit={save} className="space-y-3">
        <Labeled label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Labeled>
        <Labeled label="Name preference — what should Echo call you?">
          <input
            type="text"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            placeholder="e.g. James, Boss, Mr. Blacketer (blank = your first name)"
            maxLength={120}
            className={inputClass}
          />
        </Labeled>
        {!isTeamMember && (
          <Labeled label="Team size">
            <input
              type="number"
              min="1"
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
              className={inputClass}
            />
          </Labeled>
        )}
        {notice && <p className="text-sm text-green-600">{notice}</p>}
        <ErrorBanner message={error} />
        <button disabled={saving} className={primaryBtn}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Card>
  );
}

function FacebookCard() {
  return (
    <Card title="Facebook connection">
      <FacebookConnect />
    </Card>
  );
}

function TwilioCard({ brandId }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getTwilioConfig(brandId);
      setConfig(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setConfig(null);
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.saveTwilioConfig({ brandId, accountSid, authToken, phoneNumber });
      setNotice("Twilio connected.");
      setAccountSid("");
      setAuthToken("");
      setPhoneNumber("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.deleteTwilioConfig(brandId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!brandId)
    return (
      <Card title="Twilio (AI Phone Agent)">
        <p className="text-sm text-gray-400">
          Select or create a brand to connect a phone number.
        </p>
      </Card>
    );

  if (loading)
    return (
      <Card title="Twilio (AI Phone Agent)">
        <Spinner label="Loading…" />
      </Card>
    );

  return (
    <Card title="Twilio (AI Phone Agent)">
      {config && config.configured ? (
        <div className="space-y-3">
          <Row label="Connected number" value={config.phoneNumber} />
          <Row label="Account SID" value={config.accountSid} />
          <span className="inline-block rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
            Connected
          </span>
          {notice && <p className="text-sm text-green-600">{notice}</p>}
          <ErrorBanner message={error} />
          <button
            onClick={disconnect}
            disabled={saving}
            className="block rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Working…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-gray-400">
            Connect your Twilio account to place AI outbound calls and answer
            inbound calls. Set the number's voice webhook to{" "}
            <code className="text-amber-400">/api/phone/inbound</code> (POST).
          </p>
          <Labeled label="Account SID">
            <input
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder="ACxxxxxxxx…"
              className={inputClass}
            />
          </Labeled>
          <Labeled label="Auth Token">
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Your Twilio auth token"
              className={inputClass}
            />
          </Labeled>
          <Labeled label="Phone Number">
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+15551234567"
              className={inputClass}
            />
          </Labeled>
          {notice && <p className="text-sm text-green-600">{notice}</p>}
          <ErrorBanner message={error} />
          <button disabled={saving} className={primaryBtn}>
            {saving ? "Connecting…" : "Connect Twilio"}
          </button>
        </form>
      )}
    </Card>
  );
}

function BrandCard({ brandId, onBrandsChanged }) {
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiscovery, setShowDiscovery] = useState(false);

  const load = useCallback(async () => {
    if (!brandId) {
      setBrand(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setBrand(await api.getBrand(brandId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card title="Brand profile">
      {loading ? (
        <Spinner label="Loading…" />
      ) : brand ? (
        <div className="space-y-2 text-sm">
          <Row label="Name" value={brand.brand_name} />
          <Row label="Personality" value={brand.brand_personality} />
          <Row label="Voice" value={brand.voice_description} />
          <Row label="Audience" value={brand.target_audience} />
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          No brand profile yet. Start a discovery conversation to create one.
        </p>
      )}
      <ErrorBanner message={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => setShowDiscovery(true)}
          className={primaryBtn}
        >
          {brand ? "Restart brand discovery" : "Start brand discovery"}
        </button>
        <button
          onClick={() =>
            window.dispatchEvent(new Event("echoai:open-setup-agent"))
          }
          className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-4 py-2 text-sm font-semibold text-teal-300 hover:bg-teal-500/20"
        >
          Set up with the AI agent
        </button>
      </div>

      {showDiscovery && (
        <BrandDiscovery
          brandId={brandId || undefined}
          onClose={() => setShowDiscovery(false)}
          onComplete={() => {
            setShowDiscovery(false);
            load();
            if (onBrandsChanged) onBrandsChanged();
          }}
        />
      )}
    </Card>
  );
}
