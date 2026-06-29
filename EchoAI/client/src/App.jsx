import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, setToken, clearToken } from "./api.js";
import Sidebar, { accentTierForSection } from "./components/Sidebar.jsx";
import Spinner from "./components/Spinner.jsx";
import TierBadge from "./components/TierBadge.jsx";
import Login from "./sections/Login.jsx";
import Overview from "./sections/Overview.jsx";
import Leads from "./sections/Leads.jsx";
import Campaigns from "./sections/Campaigns.jsx";
import AdStudio from "./sections/AdStudio.jsx";
import SocialMedia from "./sections/SocialMedia.jsx";
import VideoContent from "./sections/VideoContent.jsx";
import SalesScripts from "./sections/SalesScripts.jsx";
import EmailMarketing from "./sections/EmailMarketing.jsx";
import ImageStudio from "./sections/ImageStudio.jsx";
import GoogleSeo from "./sections/GoogleSeo.jsx";
import RoiDashboard from "./sections/RoiDashboard.jsx";
import CustomerIntelligence from "./sections/CustomerIntelligence.jsx";
import Reputation from "./sections/Reputation.jsx";
import PhoneAgent from "./sections/PhoneAgent.jsx";
import Appointments from "./sections/Appointments.jsx";
import FollowUps from "./sections/FollowUps.jsx";
import SmsMarketing from "./sections/SmsMarketing.jsx";
import ChatbotSetup from "./sections/ChatbotSetup.jsx";
import Feedback from "./sections/Feedback.jsx";
import ZapierIntegration from "./sections/ZapierIntegration.jsx";
import Settings from "./sections/Settings.jsx";
import OnboardingWizard from "./onboarding/OnboardingWizard.jsx";
import AdminPanel from "./admin/AdminPanel.jsx";
import AgencyPortal from "./sections/AgencyPortal.jsx";
import AffiliateProgram from "./sections/AffiliateProgram.jsx";
import PaymentFailedBanner from "./components/PaymentFailedBanner.jsx";
import FeatureGate from "./components/FeatureGate.jsx";
import { requiredTierForSection, accentColor } from "./lib/tiers.js";
import { enablePushNotifications } from "./push.js";
import TourProvider from "./tour/TourProvider.jsx";
import SectionHelp from "./tour/SectionHelp.jsx";

export default function App() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [section, setSection] = useState("overview");
  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [brandsError, setBrandsError] = useState("");
  // null = unknown (still loading the profile), true/false once known.
  const [onboardingCompleted, setOnboardingCompleted] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAgencyOwner, setIsAgencyOwner] = useState(false);
  // Identity shown in the top bar next to the tier badge.
  const [userEmail, setUserEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  // Image handed off from Image Studio to the Social Media generator.
  const [socialPrefillImage, setSocialPrefillImage] = useState(null);
  // Subscription status drives the global payment-failed banner.
  const [billingStatus, setBillingStatus] = useState(null);
  // When the banner's "Update payment method" is clicked, jump to Settings →
  // Billing and auto-open the card form.
  const [billingTab, setBillingTab] = useState("account");
  const [openPaymentModal, setOpenPaymentModal] = useState(false);
  // Workspace context for team members. Defaults to "owner" (acting as
  // themselves) until the profile loads.
  const [workspaceRole, setWorkspaceRole] = useState("owner");
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [ownerBusinessName, setOwnerBusinessName] = useState(null);
  // A pending team invitation token pulled from the ?invite= link, consumed
  // once the user is authenticated.
  const [inviteToken, setInviteToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("invite") || null;
    } catch {
      return null;
    }
  });
  const [inviteNotice, setInviteNotice] = useState("");

  function handleUseImageInSocial(image) {
    setSocialPrefillImage(image);
    setSection("social");
  }

  function handleFixPayment() {
    setBillingTab("billing");
    setOpenPaymentModal(true);
    setSection("settings");
  }

  // Sends the user to Settings → Billing to upgrade their plan (from a locked
  // feature's upgrade prompt or a sidebar lock).
  function handleUpgrade() {
    setBillingTab("billing");
    setOpenPaymentModal(false);
    setSection("settings");
  }

  // Manual navigation (sidebar) resets the billing deep-link flags so Settings
  // opens on its default Account tab without auto-opening the card form.
  function handleSelectSection(next) {
    setBillingTab("account");
    setOpenPaymentModal(false);
    setSection(next);
  }

  const handleLogout = useCallback(() => {
    clearToken();
    setAuthed(false);
    setBrands([]);
    setSelectedBrandId("");
    setOnboardingCompleted(null);
    setIsAdmin(false);
    navigate("/");
  }, [navigate]);

  const loadBrands = useCallback(async () => {
    setLoadingBrands(true);
    setBrandsError("");
    try {
      const data = await api.getBrands();
      const list = data.brands || [];
      setBrands(list);
      setSelectedBrandId((prev) => prev || (list[0] ? list[0].brand_id : ""));
    } catch (err) {
      if (err.status === 401) {
        handleLogout();
        return;
      }
      setBrandsError(err.message);
    } finally {
      setLoadingBrands(false);
    }
  }, [handleLogout]);

  // Once authenticated, find out whether the user still needs onboarding.
  useEffect(() => {
    if (!authed) return;
    let active = true;
    (async () => {
      try {
        const profile = await api.getProfile();
        if (active) {
          setOnboardingCompleted(Boolean(profile.onboardingCompleted));
          setIsAdmin(profile.role === "admin");
          setWorkspaceRole(profile.workspaceRole || "owner");
          setIsTeamMember(Boolean(profile.isTeamMember));
          setOwnerBusinessName(profile.ownerBusinessName || null);
          setUserEmail(profile.email || "");
          setBusinessName(profile.businessName || profile.ownerBusinessName || "");
        }
        // Detect whether this account owns a white-label agency (shows the
        // Agency Portal nav). A 404 simply means "not an agency owner".
        try {
          await api.getAgencySettings();
          if (active) setIsAgencyOwner(true);
        } catch {
          if (active) setIsAgencyOwner(false);
        }
      } catch (err) {
        if (err.status === 401) {
          handleLogout();
          return;
        }
        // If the profile can't be read, fall back to showing the dashboard
        // rather than trapping the user in onboarding.
        if (active) setOnboardingCompleted(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [authed, handleLogout]);

  // Only load brands once the user has finished onboarding (the dashboard view).
  useEffect(() => {
    if (authed && onboardingCompleted) loadBrands();
  }, [authed, onboardingCompleted, loadBrands]);

  // Consume a pending team invitation once authenticated. Accepting joins the
  // owner's workspace; we then re-read the profile so the remapped role/context
  // takes effect, and strip the token from the URL.
  useEffect(() => {
    if (!authed || !inviteToken) return;
    let active = true;
    (async () => {
      try {
        const res = await api.acceptTeamInvite(inviteToken);
        if (!active) return;
        setInviteNotice(
          `You've joined ${res.businessName || "the workspace"} as ${
            res.role || "a team member"
          }.`
        );
        const profile = await api.getProfile();
        if (!active) return;
        setOnboardingCompleted(Boolean(profile.onboardingCompleted));
        setWorkspaceRole(profile.workspaceRole || "owner");
        setIsTeamMember(Boolean(profile.isTeamMember));
        setOwnerBusinessName(profile.ownerBusinessName || null);
      } catch (err) {
        if (active)
          setInviteNotice(err.message || "Could not accept the invitation.");
      } finally {
        if (active) {
          setInviteToken(null);
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete("invite");
            window.history.replaceState({}, "", url.pathname + url.search);
          } catch {
            /* no-op */
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authed, inviteToken]);

  // Poll subscription status so the payment-failed banner stays current across
  // every dashboard page until the issue is resolved.
  const loadBillingStatus = useCallback(async () => {
    try {
      setBillingStatus(await api.getSubscriptionStatus());
    } catch {
      // A missing/unreadable subscription simply means no banner.
      setBillingStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!authed || !onboardingCompleted) return;
    loadBillingStatus();
    const id = setInterval(loadBillingStatus, 60000);
    // Refresh immediately when a billing action (card update / plan change)
    // succeeds, so the payment-failed banner clears without waiting for the poll.
    window.addEventListener("echoai:billing-updated", loadBillingStatus);
    return () => {
      clearInterval(id);
      window.removeEventListener("echoai:billing-updated", loadBillingStatus);
    };
  }, [authed, onboardingCompleted, loadBillingStatus]);

  // Return to the login screen whenever any protected request reports an
  // expired or invalid token.
  useEffect(() => {
    window.addEventListener("echoai:unauthorized", handleLogout);
    return () => window.removeEventListener("echoai:unauthorized", handleLogout);
  }, [handleLogout]);

  function handleLogin(token) {
    setToken(token);
    setAuthed(true);
    setSection("overview");
    // On first login, ask to enable push so the owner gets instant hot-lead
    // alerts on their phone. Best-effort — never blocks the login flow.
    enablePushNotifications(token).catch(() => {});
  }

  if (!authed)
    return <Login onLogin={handleLogin} invitePending={Boolean(inviteToken)} />;

  // Wait until we know the onboarding status before deciding what to render.
  if (onboardingCompleted === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // New users go through the setup wizard; it disappears for good once complete.
  if (!onboardingCompleted) {
    return <OnboardingWizard onComplete={() => setOnboardingCompleted(true)} />;
  }

  // Effective tier for client-side gating. Admins bypass every gate (treated as
  // top tier). Otherwise the tier comes from the subscription status; null until
  // it loads so FeatureGate shows a spinner rather than flashing a prompt.
  const currentTier = isAdmin
    ? "enterprise"
    : billingStatus
      ? billingStatus.subscriptionTier
      : null;

  // Accent color for the section currently being viewed — reinforces the tier
  // association on the content cards (blue/purple/gold, teal for core sections).
  const sectionAccent = accentColor(accentTierForSection(section));

  // Wraps a section node in a FeatureGate when that section requires a tier.
  function gate(key, node) {
    const req = requiredTierForSection(key);
    if (!req) return node;
    return (
      <FeatureGate
        feature={key}
        requiredTier={req}
        currentTier={currentTier}
        onUpgrade={handleUpgrade}
      >
        {node}
      </FeatureGate>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black md:flex-row">
      <Sidebar
        section={section}
        onSelect={handleSelectSection}
        onLogout={handleLogout}
        isAdmin={isAdmin}
        isAgencyOwner={isAgencyOwner}
        tier={currentTier}
        workspaceRole={workspaceRole}
        isTeamMember={isTeamMember}
        ownerBusinessName={ownerBusinessName}
      />
      <main
        className="flex-1 p-4 pb-24 md:p-8 md:pb-8"
        style={{ "--tier-accent": sectionAccent }}
      >
        <div className="mx-auto max-w-6xl">
          <TopBar
            businessName={businessName}
            email={userEmail}
            tier={currentTier}
            isAdmin={isAdmin}
            section={section}
          />
          <div
            className="border-l-2 pl-3 md:pl-4"
            style={{ borderLeftColor: "var(--tier-accent)" }}
          >
          {section === "admin" && isAdmin ? (
            <AdminPanel />
          ) : section === "agency" ? (
            isAgencyOwner ? (
              <AgencyPortal />
            ) : (
              <FeatureGate
                feature="agency"
                requiredTier="enterprise"
                currentTier={currentTier}
                onUpgrade={handleUpgrade}
              >
                {/* Enterprise users who are not provisioned as an agency owner
                    still don't have a portal — show an informational note. */}
                <div className="mx-auto max-w-xl rounded-2xl border border-gray-700 bg-gray-900/60 p-8 text-center">
                  <h2 className="text-xl font-bold text-gray-100">White Label</h2>
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">
                    White-label agency accounts are provisioned by the EchoAI team.
                    Contact support to have your agency enabled and start reselling
                    EchoAI under your own brand.
                  </p>
                </div>
              </FeatureGate>
            )
          ) : section === "affiliate" ? (
            <FeatureGate
              feature="affiliate"
              requiredTier="enterprise"
              currentTier={currentTier}
              onUpgrade={handleUpgrade}
            >
              <AffiliateProgram />
            </FeatureGate>
          ) : (
            <>
              <PaymentFailedBanner status={billingStatus} onFix={handleFixPayment} />
              {inviteNotice && (
                <div className="mb-6 flex items-start justify-between gap-3 rounded-lg bg-green-500/10 p-3 text-sm text-green-300">
                  <span>{inviteNotice}</span>
                  <button
                    onClick={() => setInviteNotice("")}
                    className="shrink-0 text-green-400 hover:text-green-200"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}
              <BrandBar
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelect={setSelectedBrandId}
                loading={loadingBrands}
                error={brandsError}
              />
              {section === "overview" && <Overview brandId={selectedBrandId} />}
              {section === "leads" && <Leads brandId={selectedBrandId} />}
              {section === "campaigns" && <Campaigns />}
              {section === "adstudio" && gate("adstudio", <AdStudio brandId={selectedBrandId} />)}
              {section === "social" && (
                <SocialMedia
                  brandId={selectedBrandId}
                  tier={currentTier}
                  prefillImage={socialPrefillImage}
                  onPrefillConsumed={() => setSocialPrefillImage(null)}
                />
              )}
              {section === "contentcalendar" &&
                gate(
                  "contentcalendar",
                  <SocialMedia
                    brandId={selectedBrandId}
                    initialTab="ai-calendar"
                    prefillImage={socialPrefillImage}
                    onPrefillConsumed={() => setSocialPrefillImage(null)}
                  />,
                )}
              {section === "video" && gate("video", <VideoContent brandId={selectedBrandId} />)}
              {section === "sales" && gate("sales", <SalesScripts brandId={selectedBrandId} />)}
              {section === "email" &&
                gate("email", <EmailMarketing brandId={selectedBrandId} />)}
              {section === "image" &&
                gate(
                  "image",
                  <ImageStudio
                    brandId={selectedBrandId}
                    onUseInSocial={handleUseImageInSocial}
                  />,
                )}
              {section === "googleseo" && (
                <GoogleSeo brandId={selectedBrandId} />
              )}
              {section === "roi" && (
                <RoiDashboard
                  brandId={selectedBrandId}
                  currentTier={currentTier}
                  onUpgrade={handleUpgrade}
                />
              )}
              {section === "intelligence" &&
                gate(
                  "intelligence",
                  <CustomerIntelligence brandId={selectedBrandId} />,
                )}
              {section === "reputation" &&
                gate("reputation", <Reputation brandId={selectedBrandId} />)}
              {section === "phone" &&
                gate("phone", <PhoneAgent brandId={selectedBrandId} />)}
              {section === "appointments" &&
                gate(
                  "appointments",
                  <Appointments brandId={selectedBrandId} />,
                )}
              {section === "followups" &&
                gate("followups", <FollowUps brandId={selectedBrandId} />)}
              {section === "sms" &&
                gate("sms", <SmsMarketing brandId={selectedBrandId} />)}
              {section === "chatbot" && (
                <ChatbotSetup brandId={selectedBrandId} />
              )}
              {section === "feedback" &&
                gate("feedback", <Feedback brandId={selectedBrandId} />)}
              {section === "zapier" &&
                gate("zapier", <ZapierIntegration brandId={selectedBrandId} />)}
              {section === "settings" && (
                <Settings
                  brandId={selectedBrandId}
                  onBrandsChanged={loadBrands}
                  initialTab={billingTab}
                  openPaymentModal={openPaymentModal}
                  workspaceRole={workspaceRole}
                  isTeamMember={isTeamMember}
                  isAdmin={isAdmin}
                  tier={currentTier}
                  key={`${billingTab}-${openPaymentModal}`}
                />
              )}
            </>
          )}
          </div>
        </div>
      </main>
      <TourProvider
        tier={currentTier}
        isAdmin={isAdmin}
        businessName={businessName}
        onNavigate={setSection}
      />
    </div>
  );
}

// Top bar shown above every dashboard view: the business name / email on the
// left and the tier badge on the right so the current plan is always visible.
function TopBar({ businessName, email, tier, isAdmin, section }) {
  const primary = businessName || email || "Your account";
  const secondary = businessName && email ? email : "";
  return (
    <div className="mb-6 flex items-center justify-between gap-3 border-b border-gray-800 pb-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-gray-100">
          {primary}
        </div>
        {secondary && (
          <div className="truncate text-xs text-gray-500">{secondary}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <SectionHelp sectionKey={section} tourAnchor />
        <TierBadge tier={tier} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

function BrandBar({ brands, selectedBrandId, onSelect, loading, error }) {
  if (loading)
    return (
      <div className="mb-6">
        <Spinner label="Loading brands…" />
      </div>
    );
  if (error)
    return (
      <div className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );
  if (brands.length === 0)
    return (
      <div className="mb-6 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
        No brands yet. Go to Settings to start your brand discovery
        conversation.
      </div>
    );
  if (brands.length === 1) return null;

  return (
    <div className="mb-6 flex items-center gap-2" data-tour="brand-selector">
      <label className="text-sm font-medium text-gray-400">Brand</label>
      <select
        value={selectedBrandId}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100"
      >
        {brands.map((b) => (
          <option key={b.brand_id} value={b.brand_id}>
            {b.brand_name}
          </option>
        ))}
      </select>
    </div>
  );
}
