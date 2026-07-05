import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, setToken, clearToken } from "./api.js";
import Sidebar, { accentTierForSection } from "./components/Sidebar.jsx";
import Spinner from "./components/Spinner.jsx";
import TierBadge from "./components/TierBadge.jsx";
import Login from "./sections/Login.jsx";
import MissionControl from "./sections/MissionControl.jsx";
import AiTeam from "./sections/AiTeam.jsx";
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
import SetupAgent from "./onboarding/SetupAgent.jsx";
import AdminPanel from "./admin/AdminPanel.jsx";
import AgencyPortal from "./sections/AgencyPortal.jsx";
import AffiliateProgram from "./sections/AffiliateProgram.jsx";
import PaymentFailedBanner from "./components/PaymentFailedBanner.jsx";
import FeatureGate from "./components/FeatureGate.jsx";
import { requiredTierForSection, accentColor } from "./lib/tiers.js";
import { enablePushNotifications } from "./push.js";
import TourProvider from "./tour/TourProvider.jsx";
import SectionHelp from "./tour/SectionHelp.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import HealthSupportWidget from "./components/HealthSupportWidget.jsx";
import EchoCompanion from "./companion/EchoCompanion.jsx";
import DepartmentView from "./sections/DepartmentView.jsx";
import SentinelHealth from "./sections/SentinelHealth.jsx";
import SalesRepConsole from "./sections/crm/SalesRepConsole.jsx";
import QueueOverview from "./sections/crm/QueueOverview.jsx";
import CallMonitoring from "./sections/crm/CallMonitoring.jsx";
import { roleLabel, roleBadgeClass, canWrite } from "./lib/roles.js";
import Breadcrumbs from "./components/Breadcrumbs.jsx";
import FacebookWizard from "./components/FacebookWizard.jsx";
import { MemoryTab, AutonomousTab } from "./companion/EchoBrain.jsx";
import { agentMeta, sectionTitle } from "./lib/departments.js";

export default function App() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [section, setSection] = useState("missioncontrol");
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
  // AI Setup Agent overlay — auto-launches for brand-new users and resumes any
  // in-progress session; can also be opened manually from Settings.
  const [showSetup, setShowSetup] = useState(false);
  // True when the user stepped out of the Setup Agent to connect an account (e.g.
  // social) and still has an unfinished session to return to. Drives the floating
  // "Finish setup" button so they can jump back into the flow.
  const [setupPending, setSetupPending] = useState(false);
  // Team-based navigation. The dashboard is organized around the eight AI team
  // members: opening a department (deptAgentId) shows that member's tool grid;
  // a tool card then sets `section` to the underlying feature while deptAgentId
  // stays put so the breadcrumb/back trail reflects the department context.
  const [deptAgentId, setDeptAgentId] = useState(null);
  // Sub-tab handed to a section when a tool card targets a specific tab (e.g.
  // Sentinel's Health tabs).
  const [activeToolTab, setActiveToolTab] = useState(null);
  // App-level Facebook connect wizard (Atlas's "Connect Facebook" tool action).
  const [showFbWizard, setShowFbWizard] = useState(false);

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

  // Whether the current user can actually open a given section. Sentinel's health
  // oversight is owner/admin-only (staff never see that department), and the admin
  // console only renders for admins. Used to gate tool CTAs and as a defensive
  // navigation guard.
  const canOpenSection = useCallback(
    (s) => {
      if (!s) return false;
      if (s === "sentinelhealth") return isAdmin || !isTeamMember;
      // Call monitoring lives in Sentinel — same owner/admin-only visibility.
      if (s === "callmonitor") return isAdmin || !isTeamMember;
      if (s === "admin") return isAdmin;
      return true;
    },
    [isTeamMember, isAdmin],
  );

  // Sentinel is the only department hidden from staff; every other team member's
  // department is open to owners and staff alike.
  const canOpenDepartment = useCallback(
    (id) => {
      if (id === "sentinel") return isAdmin || !isTeamMember;
      return true;
    },
    [isTeamMember, isAdmin],
  );

  // Mission Control is home. Manual navigation (sidebar) resets the billing
  // deep-link flags and clears any open department so top-level sections open
  // cleanly. Targets the user can't open fall back to home.
  function handleSelectSection(next) {
    setBillingTab("account");
    setOpenPaymentModal(false);
    setDeptAgentId(null);
    setActiveToolTab(null);
    setSection(canOpenSection(next) ? next : "missioncontrol");
  }

  // Open a team member's Department View (the hub of clickable tool cards).
  function openDepartment(agentId) {
    if (!canOpenDepartment(agentId)) return;
    setDeptAgentId(agentId);
    setActiveToolTab(null);
    setSection("department");
  }

  // Open a specific tool from a Department View. deptAgentId stays set so the
  // breadcrumb/back trail keeps the department context; a tool may request a
  // sub-tab (e.g. Sentinel's Health tabs) or an App-level action.
  function openTool(tool) {
    if (!tool) return;
    if (tool.action) {
      handleToolAction(tool.action);
      return;
    }
    if (!canOpenSection(tool.section)) return;
    setActiveToolTab(tool.tab || null);
    setSection(tool.section);
  }

  // App-level actions a tool card can trigger instead of navigating to a section.
  function handleToolAction(action) {
    if (action === "facebook") setShowFbWizard(true);
  }

  // Mission Control is home.
  function goHome() {
    setDeptAgentId(null);
    setActiveToolTab(null);
    setSection("missioncontrol");
  }

  // Back button: from a tool, return to its department; otherwise go home.
  function handleBack() {
    if (section !== "department" && deptAgentId) {
      setActiveToolTab(null);
      setSection("department");
    } else {
      goHome();
    }
  }

  // Breadcrumb trail for the current view (Home > Department > Tool).
  function buildCrumbs() {
    const crumbs = [{ label: "Home", onClick: goHome }];
    const meta = deptAgentId ? agentMeta(deptAgentId) : null;
    if (section === "department" && meta) {
      crumbs.push({ label: meta.name });
      return crumbs;
    }
    if (meta) {
      crumbs.push({
        label: meta.name,
        onClick: () => {
          setActiveToolTab(null);
          setSection("department");
        },
      });
    }
    const title = sectionTitle(section);
    if (title) crumbs.push({ label: title });
    return crumbs;
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

  // Decide whether to auto-launch the AI Setup Agent: resume any in-progress
  // session (e.g. returning from Google OAuth), otherwise offer it to a brand-new
  // user who hasn't created any brands yet. Team members never see it (they join
  // an existing workspace). Also listens for a manual open from Settings.
  useEffect(() => {
    if (!authed || !onboardingCompleted || isTeamMember) return;
    let active = true;
    (async () => {
      try {
        const { session } = await api.getSetupLatest();
        if (!active) return;
        // Auto-resume an unfinished session — either actively in progress (e.g.
        // returning from Google OAuth) or paused because the user navigated away
        // mid-interview (SetupAgent pauses on unmount).
        if (session && (session.status === "in_progress" || session.status === "paused")) {
          setShowSetup(true);
          return;
        }
        if (!session) {
          const data = await api.getBrands();
          if (active && (data.brands || []).length === 0) setShowSetup(true);
        }
      } catch {
        /* If we can't read setup status, just don't auto-launch. */
      }
    })();
    const openHandler = () => setShowSetup(true);
    window.addEventListener("echoai:open-setup-agent", openHandler);
    return () => {
      active = false;
      window.removeEventListener("echoai:open-setup-agent", openHandler);
    };
  }, [authed, onboardingCompleted, isTeamMember]);

  // Poll subscription status so the payment-failed banner stays current across
  // every dashboard page until the issue is resolved. Defined before any callback
  // that depends on it to avoid a temporal-dead-zone reference during render.
  const loadBillingStatus = useCallback(async () => {
    try {
      setBillingStatus(await api.getSubscriptionStatus());
    } catch {
      // A missing/unreadable subscription simply means no banner.
      setBillingStatus(null);
    }
  }, []);

  const handleSetupClosed = useCallback(() => {
    setShowSetup(false);
    setSetupPending(false);
    loadBrands();
    loadBillingStatus();
  }, [loadBrands, loadBillingStatus]);

  // Step out of the Setup Agent to a dashboard section (e.g. Social Accounts) to
  // connect something, keeping the unfinished session so the user can return via
  // the floating "Finish setup" button.
  const handleSetupExitToSection = useCallback((sec) => {
    setShowSetup(false);
    setSetupPending(true);
    if (sec) setSection(sec);
  }, []);

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
    setSection("missioncontrol");
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

  // Sales reps get a dedicated, focused console instead of the full dashboard:
  // one assigned lead at a time, masked phone numbers, bridge calling. They never
  // see the sidebar, other reps' work, or any other section.
  if (workspaceRole === "sales_rep") {
    return (
      <SalesRepConsole
        email={userEmail}
        ownerBusinessName={ownerBusinessName}
        onLogout={handleLogout}
      />
    );
  }

  // New users go through the setup wizard; it disappears for good once complete.
  if (!onboardingCompleted) {
    return <OnboardingWizard onComplete={() => setOnboardingCompleted(true)} />;
  }

  // The AI Setup Agent takes over the screen while active (auto-launched for new
  // users / resumed sessions, or opened manually from Settings).
  if (showSetup) {
    return (
      <SetupAgent onClose={handleSetupClosed} onExitToSection={handleSetupExitToSection} />
    );
  }

  // Effective tier for client-side gating. Admins bypass every gate (treated as
  // top tier). Otherwise the tier comes from the subscription status; null until
  // it loads so FeatureGate shows a spinner rather than flashing a prompt.
  const currentTier = isAdmin
    ? "enterprise"
    : billingStatus
      ? billingStatus.subscriptionTier
      : null;

  // Managers (and legacy viewers) are read-only everywhere: they can view every
  // section but must not see write controls. Owner, workspace-admin and the
  // platform admin can write. Passed down to sections that expose mutations.
  const readOnly = !canWrite({ isAdmin, workspaceRole });

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
        deptAgentId={deptAgentId}
        onSelectSection={handleSelectSection}
        onOpenDepartment={openDepartment}
        onLogout={handleLogout}
        isAdmin={isAdmin}
        isTeamMember={isTeamMember}
        canOpenDepartment={canOpenDepartment}
        workspaceRole={workspaceRole}
        ownerBusinessName={ownerBusinessName}
      />
      {setupPending ? (
        <button
          onClick={() => setShowSetup(true)}
          className="fixed bottom-6 right-6 z-40 rounded-full bg-teal-500 px-5 py-3 font-semibold text-black shadow-lg shadow-teal-500/30 hover:bg-teal-400"
        >
          Finish your setup →
        </button>
      ) : null}
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
            workspaceRole={workspaceRole}
            isTeamMember={isTeamMember}
            section={section}
            brandId={selectedBrandId}
          />
          {section !== "missioncontrol" && (
            <div className="mb-5 flex items-center gap-3">
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Back
              </button>
              <Breadcrumbs crumbs={buildCrumbs()} />
            </div>
          )}
          <div
            className="border-l-2 pl-3 md:pl-4"
            style={{ borderLeftColor: "var(--tier-accent)" }}
          >
          <ErrorBoundary key={`${section}:${deptAgentId || ""}`}>
          {section === "department" ? (
            <DepartmentView
              agentId={deptAgentId}
              onOpenTool={openTool}
              onAction={handleToolAction}
              canOpenSection={canOpenSection}
            />
          ) : section === "admin" && isAdmin ? (
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
              {section === "missioncontrol" && (
                <MissionControl onNavigate={handleSelectSection} onOpenDepartment={openDepartment} />
              )}
              {section === "aiteam" && (
                <AiTeam onOpenDepartment={openDepartment} />
              )}
              {section === "echomemory" && (
                <div className="mx-auto max-w-3xl">
                  <MemoryTab />
                </div>
              )}
              {section === "echogrowth" && (
                <div className="mx-auto max-w-3xl">
                  <AutonomousTab readOnly={isTeamMember || workspaceRole !== "owner"} />
                </div>
              )}
              {section === "sentinelhealth" &&
                (canOpenSection("sentinelhealth") ? (
                  <SentinelHealth brandId={selectedBrandId} initialTab={activeToolTab || "monitor"} />
                ) : null)}
              {section === "callmonitor" &&
                (canOpenSection("callmonitor") ? <CallMonitoring /> : null)}
              {section === "queueoverview" && (
                <QueueOverview readOnly={readOnly} />
              )}
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
          </ErrorBoundary>
          </div>
        </div>
      </main>
      <ErrorBoundary silent>
        <TourProvider
          tier={currentTier}
          isAdmin={isAdmin}
          businessName={businessName}
          onNavigate={setSection}
        />
      </ErrorBoundary>
      <ErrorBoundary silent>
        <HealthSupportWidget brandId={selectedBrandId} />
      </ErrorBoundary>
      {!isTeamMember ? (
        <ErrorBoundary silent>
          <EchoCompanion />
        </ErrorBoundary>
      ) : null}
      {showFbWizard && (
        <ErrorBoundary silent>
          <FacebookWizard onClose={() => setShowFbWizard(false)} />
        </ErrorBoundary>
      )}
    </div>
  );
}

// Top bar shown above every dashboard view: the business name / email on the
// left and the tier badge on the right so the current plan is always visible.
function TopBar({
  businessName,
  email,
  tier,
  isAdmin,
  workspaceRole,
  isTeamMember,
  section,
  brandId,
}) {
  const primary = businessName || email || "Your account";
  const secondary = businessName && email ? email : "";
  // Show a workspace-role badge for team members (owners don't need one).
  const showRole = isTeamMember && workspaceRole && workspaceRole !== "owner";
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
        {showRole && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeClass(
              workspaceRole,
            )}`}
            title={`Your workspace role: ${roleLabel(workspaceRole)}`}
          >
            {roleLabel(workspaceRole)}
          </span>
        )}
        <HealthIndicator brandId={brandId} />
        <SectionHelp sectionKey={section} tourAnchor />
        <TierBadge tier={tier} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

// Small colored dot in the top nav reflecting the brand's latest health check.
// Polls the status endpoint periodically so it stays fresh without a reload.
function HealthIndicator({ brandId }) {
  const [status, setStatus] = useState("unknown");

  useEffect(() => {
    if (!brandId) {
      setStatus("unknown");
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const data = await api.healthGetStatus(brandId);
        if (active) setStatus(data.overallStatus || "unknown");
      } catch {
        if (active) setStatus("unknown");
      }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [brandId]);

  const colors = {
    critical: "#ef4444",
    warning: "#f59e0b",
    healthy: "#22c55e",
    unknown: "#6b7280",
  };
  const labels = {
    critical: "Action needed on your account",
    warning: "Minor issues detected",
    healthy: "All systems healthy",
    unknown: "Health not checked yet",
  };
  return (
    <span
      className="flex items-center"
      title={labels[status] || labels.unknown}
      aria-label={labels[status] || labels.unknown}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: colors[status] || colors.unknown }}
      />
    </span>
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
