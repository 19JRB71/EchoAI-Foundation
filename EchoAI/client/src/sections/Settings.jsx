import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import BrandDiscovery from "./BrandDiscovery.jsx";
import Billing from "./billing/Billing.jsx";
import FacebookConnect from "../components/FacebookConnect.jsx";
import TeamManagement from "./team/TeamManagement.jsx";

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
  openPaymentModal = false,
  workspaceRole = "owner",
  isTeamMember = false,
}) {
  // Billing and team management are restricted to the workspace owner/admin.
  const canManage = workspaceRole === "owner" || workspaceRole === "admin";
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

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
      </div>

      {tab === "billing" && canManage ? (
        <Billing openPaymentModal={openPaymentModal} />
      ) : tab === "team" && canManage ? (
        <TeamManagement />
      ) : (
        <div className="space-y-6">
          <ProfileCard isTeamMember={isTeamMember} />
          <FacebookCard />
          <TwilioCard brandId={brandId} />
          <BrandCard brandId={brandId} onBrandsChanged={onBrandsChanged} />
        </div>
      )}
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

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-200">{value || "—"}</span>
    </div>
  );
}

function ProfileCard({ isTeamMember = false }) {
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState("");
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
      <button
        onClick={() => setShowDiscovery(true)}
        className={`${primaryBtn} mt-4`}
      >
        {brand ? "Restart brand discovery" : "Start brand discovery"}
      </button>

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
