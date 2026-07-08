// Thin fetch wrapper around the EchoAI backend. Stores the JWT in localStorage
// and attaches it as a Bearer token on protected routes.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const TOKEN_KEY = "echoai_token";

// In-memory cache of synthesized speech Blobs for short, repeated phrases so
// Echo replays common confirmations instantly. Insertion-ordered Map = simple
// FIFO eviction. Blobs are immutable, so reusing one across many plays is safe.
const echoSpeakCache = new Map();

// Permanent login: when the user keeps "remember this device" checked (the
// default) the JWT is stored in localStorage so it survives closing the browser
// (up to the 30-day token expiry). When unchecked we store it in sessionStorage
// so it is discarded the moment the browser session ends. getToken() checks both
// so either mode works transparently across the app.
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token, remember = true) {
  if (!token) return;
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    // Centralized auth expiry handling: any protected request that comes back
    // 401 clears the stored token and notifies the app to return to login.
    if (res.status === 401 && auth) {
      clearToken();
      window.dispatchEvent(new Event("echoai:unauthorized"));
    }
    const message =
      (data && data.error) ||
      (typeof data === "string" && data) ||
      `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  // Auth
  register: (email, password, teamSize, referralCode, rememberDevice = true) =>
    request("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password, teamSize, referralCode, rememberDevice },
    }),
  login: (email, password, rememberDevice = true) =>
    request("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password, rememberDevice },
    }),
  getProfile: () => request("/api/auth/profile"),

  // Music (YouTube). Playback is client-side; search needs YOUTUBE_API_KEY.
  musicStatus: () => request("/api/music/status"),
  musicSearch: (q, limit = 8) =>
    request(`/api/music/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // Guided tour progress (per authenticated user, persists across devices)
  getTourStatus: () => request("/api/tour/status"),
  saveTourProgress: ({ tourType, currentStep, completed }) =>
    request("/api/tour/progress", {
      method: "POST",
      body: { tourType, currentStep, completed },
    }),
  completeTour: (tourType) =>
    request("/api/tour/complete", { method: "POST", body: { tourType } }),

  // AI Setup Agent — conversational onboarding that configures the account
  getSetupLatest: () => request("/api/setup-agent/latest"),
  startSetupSession: () => request("/api/setup-agent/session", { method: "POST" }),
  submitSetupAnswer: (sessionId, answer) =>
    request("/api/setup-agent/answer", { method: "POST", body: { sessionId, answer } }),
  grantSetupConsent: (sessionId) =>
    request("/api/setup-agent/consent", { method: "POST", body: { sessionId } }),
  runSetupAction: (sessionId, skip = false) =>
    request("/api/setup-agent/execute", { method: "POST", body: { sessionId, skip } }),
  pauseSetupSession: (sessionId) =>
    request("/api/setup-agent/pause", { method: "POST", body: { sessionId } }),
  // Fire-and-forget pause used on hard tab/window close, where a normal fetch
  // (and the React unmount effect) is unreliable. Uses navigator.sendBeacon,
  // which can't set an Authorization header, so the JWT rides in the body and is
  // verified by the no-auth /pause-beacon endpoint. Returns true if the beacon
  // was queued. Falls back to a keepalive fetch when sendBeacon is unavailable.
  pauseSetupSessionBeacon: (sessionId) => {
    const token = getToken();
    if (!sessionId || !token) return false;
    const url = `${BASE_URL}/api/setup-agent/pause-beacon`;
    const payload = JSON.stringify({ sessionId, token });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      return navigator.sendBeacon(url, blob);
    }
    try {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  },
  dismissSetupSession: (sessionId) =>
    request("/api/setup-agent/dismiss", { method: "POST", body: { sessionId } }),
  resetSetupAgent: () =>
    request("/api/setup-agent/reset", { method: "POST" }),

  // Echo — the persistent AI companion. Drives post-setup activation and ongoing
  // management via one-click approvals.
  getEchoState: () => request("/api/echo/state"),
  advanceEcho: () => request("/api/echo/advance", { method: "POST" }),
  approveEcho: () => request("/api/echo/approve", { method: "POST" }),
  declineEcho: () => request("/api/echo/decline", { method: "POST" }),
  sendEchoMessage: (text, brandId) =>
    request("/api/echo/message", {
      method: "POST",
      body: brandId ? { text, brandId } : { text },
    }),
  getEchoBriefing: () => request("/api/echo/briefing"),
  // Voice nav "ask before reading": data-backed offer question + readout.
  getEchoSectionOffer: (section) =>
    request(`/api/echo/section-offer?section=${encodeURIComponent(section)}`),
  getEchoSectionBrief: (section) =>
    request("/api/echo/section-brief", { method: "POST", body: { section } }),
  // Voice input: POST a recorded clip as multipart to be transcribed with Whisper.
  transcribeEchoAudio: async (blob) => {
    const form = new FormData();
    form.append("audio", blob, "echo-input.webm");
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/echo/transcribe`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Transcription failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // Sage — Industry Intelligence Agent (ungated / all-tier; access is
  // brand-owner-scoped like other brand resources).
  getSageBrief: (brandId) =>
    request(`/api/sage/brief?brandId=${encodeURIComponent(brandId)}`),
  refreshSageBrief: (brandId) =>
    request("/api/sage/brief/refresh", { method: "POST", body: { brandId } }),
  getSageFeed: (brandId) =>
    request(`/api/sage/feed?brandId=${encodeURIComponent(brandId)}`),
  getSageInsights: (brandId) =>
    request(`/api/sage/insights?brandId=${encodeURIComponent(brandId)}`),
  getSageCompetitors: (brandId) =>
    request(`/api/sage/competitors?brandId=${encodeURIComponent(brandId)}`),
  addSageCompetitor: ({ brandId, name, website, facebook_page }) =>
    request("/api/sage/competitors", {
      method: "POST",
      body: { brandId, name, website, facebook_page },
    }),
  suggestSageCompetitors: (brandId) =>
    request("/api/sage/competitors/suggest", { method: "POST", body: { brandId } }),
  refreshSageCompetitor: (brandId, id) =>
    request(`/api/sage/competitors/${id}/refresh`, {
      method: "POST",
      body: { brandId },
    }),
  updateSageCompetitor: (brandId, id, status) =>
    request(`/api/sage/competitors/${id}`, {
      method: "PATCH",
      body: { brandId, status },
    }),
  deleteSageCompetitor: (brandId, id) =>
    request(`/api/sage/competitors/${id}?brandId=${encodeURIComponent(brandId)}`, {
      method: "DELETE",
    }),
  submitSageLink: ({ brandId, type, url }) =>
    request("/api/sage/input", {
      method: "POST",
      body: { brandId, type, url },
    }),
  submitSageFile: async (brandId, file) => {
    const form = new FormData();
    form.append("brandId", brandId);
    form.append("file", file, file.name);
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/sage/input`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new Event("echoai:unauthorized"));
      }
      const err = new Error(
        (data && data.error) || `Submission failed (${res.status})`,
      );
      err.status = res.status;
      throw err;
    }
    return data;
  },
  getSageSubmissions: (brandId) =>
    request(`/api/sage/submissions?brandId=${encodeURIComponent(brandId)}`),

  // AI Marketing Department — team roster, per-agent detail, Mission Control.
  getAgents: () => request("/api/agents"),
  getMissionControl: () => request("/api/agents/mission-control"),
  getAgentDetail: (agentId) => request(`/api/agents/${agentId}`),

  // Target Goals & KPI tracking (Prompt 67).
  getGoalCatalog: (brandId) => request(`/api/goals/catalog/${brandId}`),
  getGoals: (brandId) => request(`/api/goals/${brandId}`),
  getDepartmentGoals: (brandId, department) =>
    request(`/api/goals/${brandId}/department/${department}`),
  getGoalsOverview: () => request("/api/goals/overview"),
  parseGoals: (brandId, message) =>
    request(`/api/goals/${brandId}/parse`, { method: "POST", body: { message } }),
  createGoal: (brandId, body) =>
    request(`/api/goals/${brandId}`, { method: "POST", body }),
  updateGoal: (brandId, goalId, body) =>
    request(`/api/goals/${brandId}/${goalId}`, { method: "PUT", body }),
  deleteGoal: (brandId, goalId) =>
    request(`/api/goals/${brandId}/${goalId}`, { method: "DELETE" }),
  // Voter CRM (political-campaign brands)
  getSupporters: (brandId, filters = {}) => {
    const qs = new URLSearchParams();
    if (filters.type) qs.set("type", filters.type);
    if (filters.status) qs.set("status", filters.status);
    if (filters.search) qs.set("search", filters.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/supporters/${brandId}${suffix}`);
  },
  createSupporter: (brandId, body) =>
    request(`/api/supporters/${brandId}`, { method: "POST", body }),
  updateSupporter: (brandId, supporterId, body) =>
    request(`/api/supporters/${brandId}/${supporterId}`, { method: "PUT", body }),
  deleteSupporter: (brandId, supporterId) =>
    request(`/api/supporters/${brandId}/${supporterId}`, { method: "DELETE" }),
  getCampaignEvents: (brandId) => request(`/api/supporters/${brandId}/events`),
  createCampaignEvent: (brandId, body) =>
    request(`/api/supporters/${brandId}/events`, { method: "POST", body }),
  updateCampaignEvent: (brandId, eventId, body) =>
    request(`/api/supporters/${brandId}/events/${eventId}`, { method: "PUT", body }),
  deleteCampaignEvent: (brandId, eventId) =>
    request(`/api/supporters/${brandId}/events/${eventId}`, { method: "DELETE" }),

  // Goal-alert feed management (dismiss one alert / mute a goal's alerts).
  getGoalAlerts: (brandId) => request(`/api/goals/${brandId}/alerts`),
  dismissGoalAlert: (brandId, alertId) =>
    request(`/api/goals/${brandId}/alerts/${alertId}/dismiss`, { method: "POST" }),
  muteGoalAlerts: (brandId, goalId, muted) =>
    request(`/api/goals/${brandId}/${goalId}/alerts/mute`, {
      method: "POST",
      body: { muted },
    }),

  // Echo memory (persistent recall) + Autonomous Growth Mode.
  getEchoMemory: () => request("/api/echo/memory"),
  recallEchoMemory: (query) =>
    request("/api/echo/memory/recall", { method: "POST", body: { query } }),
  searchEchoMemory: (q) =>
    request(`/api/echo/memory/search?q=${encodeURIComponent(q || "")}`),
  captureEchoMemory: (body) =>
    request("/api/echo/memory", { method: "POST", body }),
  deleteEchoMemory: (id) =>
    request(`/api/echo/memory/${id}`, { method: "DELETE" }),
  getEchoProfiles: () => request("/api/echo/profiles"),
  saveEchoProfile: (body) =>
    request("/api/echo/profiles", { method: "PUT", body }),
  deleteEchoProfile: (id) =>
    request(`/api/echo/profiles/${id}`, { method: "DELETE" }),
  getEchoOwnerProfile: () => request("/api/echo/owner-profile"),
  saveEchoOwnerProfile: (body) =>
    request("/api/echo/owner-profile", { method: "PUT", body }),
  getEchoGrowth: () => request("/api/echo/growth"),
  updateEchoGrowth: (settings) =>
    request("/api/echo/growth", { method: "PUT", body: settings }),
  getEchoGrowthActions: () => request("/api/echo/growth/actions"),
  approveEchoGrowthAction: (id) =>
    request(`/api/echo/growth/actions/${id}/approve`, { method: "POST" }),
  declineEchoGrowthAction: (id) =>
    request(`/api/echo/growth/actions/${id}/decline`, { method: "POST" }),

  getSignupMode: () => request("/api/auth/signup-mode"),
  updateProfile: (payload) =>
    request("/api/auth/profile", { method: "PUT", body: payload }),
  updateOnboarding: (payload) =>
    request("/api/auth/profile/onboarding", { method: "PUT", body: payload }),

  // Subscription
  getSubscriptionStatus: () => request("/api/subscriptions/status"),
  createSubscription: (paymentMethodId, tier) =>
    request("/api/subscriptions", {
      method: "POST",
      body: { paymentMethodId, tier },
    }),
  cancelSubscription: () =>
    request("/api/subscriptions/cancel", { method: "POST" }),
  getPlans: () => request("/api/subscriptions/plans"),
  changeSubscription: (tier) =>
    request("/api/subscriptions/change", { method: "POST", body: { tier } }),
  updateTeamSize: (teamSize) =>
    request("/api/subscriptions/team", { method: "POST", body: { teamSize } }),
  getPaymentMethod: () => request("/api/subscriptions/payment-method"),
  updatePaymentMethod: (paymentMethodId) =>
    request("/api/subscriptions/payment-method", {
      method: "POST",
      body: { paymentMethodId },
    }),
  getBillingHistory: () => request("/api/subscriptions/invoices"),
  getUpcomingInvoice: () => request("/api/subscriptions/upcoming-invoice"),

  // Team members & roles
  getTeam: () => request("/api/team"),
  inviteTeamMember: (email, role, phone) =>
    request("/api/team/invite", { method: "POST", body: { email, role, phone } }),
  resendTeamInvite: (teamMemberId) =>
    request("/api/team/resend", { method: "POST", body: { teamMemberId } }),
  changeTeamRole: (teamMemberId, role, phone) =>
    request("/api/team/role", { method: "PUT", body: { teamMemberId, role, phone } }),
  deactivateTeamMember: (teamMemberId) =>
    request("/api/team/deactivate", { method: "POST", body: { teamMemberId } }),
  reactivateTeamMember: (teamMemberId) =>
    request("/api/team/reactivate", { method: "POST", body: { teamMemberId } }),
  removeTeamMember: (teamMemberId) =>
    request(`/api/team/${teamMemberId}`, { method: "DELETE" }),
  acceptTeamInvite: (token) =>
    request("/api/team/accept", { method: "POST", body: { token } }),

  // Employee Accountability CRM — sales-rep queue, queue management, monitoring
  crmGetCurrentLead: () => request("/api/crm/current"),
  crmCallCurrentLead: () => request("/api/crm/call", { method: "POST" }),
  crmCompleteLead: (payload) =>
    request("/api/crm/complete", { method: "POST", body: payload }),
  crmGetQueue: () => request("/api/crm/queue"),
  crmQueueOverview: () => request("/api/crm/queue/overview"),
  crmAssignToQueue: (leadId, repUserId) =>
    request("/api/crm/queue/assign", {
      method: "POST",
      body: { leadId, repUserId },
    }),
  crmSetPriority: (leadId, priority) =>
    request("/api/crm/queue/priority", {
      method: "POST",
      body: { leadId, priority },
    }),
  crmRemoveFromQueue: (leadId) =>
    request("/api/crm/queue/remove", { method: "POST", body: { leadId } }),
  crmCallsToday: () => request("/api/crm/calls/today"),
  crmLeadLog: (leadId) => request(`/api/crm/leads/${leadId}/log`),
  // The recording endpoint is auth-protected, so an <audio src> can't attach the
  // Bearer token. Fetch the media as a blob with the token and return an object
  // URL the caller can play (and must revoke when done).
  crmRecordingBlobUrl: async (callId) => {
    const token = getToken();
    const res = await fetch(`${BASE_URL}/api/crm/recording/${callId}/audio`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new Event("echoai:unauthorized"));
      }
      throw new Error("Could not load the recording.");
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // Brands
  getBrands: () => request("/api/brands"),
  getBrand: (brandId) => request(`/api/brands/${brandId}`),
  updateBrand: (brandId, payload) =>
    request(`/api/brands/${brandId}`, { method: "PUT", body: payload }),
  discovery: (payload) =>
    request("/api/brands/discovery", { method: "POST", body: payload }),

  // Leads
  getLeads: (brandId, temperature) => {
    const params = new URLSearchParams({ brandId });
    if (temperature) params.set("temperature", temperature);
    return request(`/api/leads?${params.toString()}`);
  },
  getLead: (leadId) => request(`/api/leads/${leadId}`),

  // Campaigns
  getCampaigns: () => request("/api/campaigns/performance"),
  optimizeCampaigns: () =>
    request("/api/campaigns/optimize", { method: "POST" }),
  connectFacebook: (adAccountId) =>
    request("/api/campaigns/connect", {
      method: "POST",
      body: { adAccountId },
    }),

  // Facebook OAuth connection
  getFacebookAccounts: () => request("/api/facebook/accounts"),
  selectFacebookAccount: (accountId) =>
    request("/api/facebook/select-account", {
      method: "POST",
      body: { accountId },
    }),
  selectFacebookPage: (pageId) =>
    request("/api/facebook/select-page", {
      method: "POST",
      body: { pageId },
    }),
  verifyFacebookConnection: () => request("/api/facebook/verify"),
  disconnectFacebook: () =>
    request("/api/facebook/disconnect", { method: "POST" }),
  // Authenticated initiation: returns the Facebook dialog URL the client should
  // navigate to. Keeps the bearer token in the Authorization header (not the URL).
  startFacebookOAuth: () =>
    request("/api/facebook/oauth/initiate", { method: "POST" }),

  // Analytics
  getAnalytics: (brandId) => request(`/api/analytics/${brandId}`),
  getCurrentWeek: (brandId) => request(`/api/analytics/${brandId}/current`),

  // Admin
  adminGetStats: () => request("/api/admin/stats"),
  adminGetHealth: () => request("/api/admin/health"),
  adminGetUsers: ({ page = 1, limit = 50 } = {}) =>
    request(`/api/admin/users?page=${page}&limit=${limit}`),
  adminGetUser: (userId) => request(`/api/admin/users/${userId}`),
  adminUnlockUser: (userId) =>
    request(`/api/admin/users/${userId}/unlock`, { method: "POST" }),
  adminLockUser: (userId) =>
    request(`/api/admin/users/${userId}/lock`, { method: "POST" }),
  adminUpdateUserTier: (userId, tier) =>
    request(`/api/admin/users/${userId}/subscription`, {
      method: "PUT",
      body: { tier },
    }),
  adminDeleteUser: (userId) =>
    request(`/api/admin/users/${userId}`, { method: "DELETE" }),

  // Full Diagnostic Report (admin-only).
  adminGetDiagnostics: () => request("/api/admin/diagnostics/report"),

  // Demo Account & Sales Presentation Mode (admin-only).
  demoGetStatus: () => request("/api/admin/demo/status"),
  demoGetScript: () => request("/api/admin/demo/script"),
  demoSeed: (businessName) =>
    request("/api/admin/demo/seed", { method: "POST", body: { businessName } }),
  demoReset: () => request("/api/admin/demo/reset", { method: "POST" }),
  demoActivate: () => request("/api/admin/demo/activate", { method: "POST" }),
  demoDeactivate: () => request("/api/admin/demo/deactivate", { method: "POST" }),
  demoUpdateConfig: (payload) =>
    request("/api/admin/demo/config", { method: "PUT", body: payload }),
  demoAdaptSuggestions: (scenario) =>
    request("/api/admin/demo/suggestions/adapt", {
      method: "POST",
      body: { scenario },
    }),

  // Social media
  getSocialCalendar: (brandId) => request(`/api/social/calendar/${brandId}`),
  getSocialPerformance: (brandId) => request(`/api/social/performance/${brandId}`),
  getSocialAccounts: (brandId) => request(`/api/social/accounts/${brandId}`),
  generateSocial: (brandId, topic, platform) =>
    request("/api/social/generate", {
      method: "POST",
      body: { brandId, topic, platform },
    }),
  scheduleSocial: ({ brandId, platform, postContent, scheduledTime }) =>
    request("/api/social/schedule", {
      method: "POST",
      body: { brandId, platform, postContent, scheduledTime },
    }),
  rescheduleSocialPost: (postId, scheduledTime) =>
    request(`/api/social/posts/${postId}/reschedule`, {
      method: "PUT",
      body: { scheduledTime },
    }),
  connectSocial: ({ brandId, platform, credentials, username }) =>
    request("/api/social/connect", {
      method: "POST",
      body: { brandId, platform, credentials, username },
    }),
  disconnectSocial: (brandId, platform) =>
    request(`/api/social/accounts/${brandId}/${platform}`, { method: "DELETE" }),

  // AI Content Calendar & Auto-Posting Scheduler
  generateContentCalendar: ({ brandId, postingFrequency, platforms, contentTheme }) =>
    request("/api/content-calendar/generate", {
      method: "POST",
      body: { brandId, postingFrequency, platforms, contentTheme },
    }),
  saveContentCalendar: ({ brandId, postingFrequency, contentTheme, posts }) =>
    request("/api/content-calendar", {
      method: "POST",
      body: { brandId, postingFrequency, contentTheme, posts },
    }),
  getContentCalendar: (brandId) => request(`/api/content-calendar/${brandId}`),
  activateContentCalendar: (calendarId) =>
    request("/api/content-calendar/activate", {
      method: "POST",
      body: { calendarId },
    }),
  pauseContentCalendar: (calendarId) =>
    request("/api/content-calendar/pause", {
      method: "POST",
      body: { calendarId },
    }),
  regenerateCalendarPost: (postId) =>
    request("/api/content-calendar/regenerate-post", {
      method: "POST",
      body: { postId },
    }),
  updateCalendarPost: (postId, postContent) =>
    request(`/api/content-calendar/post/${postId}`, {
      method: "PUT",
      body: { postContent },
    }),
  getCalendarPostingSettings: (brandId) =>
    request(`/api/content-calendar/settings/${brandId}`),
  saveCalendarPostingSettings: (brandId, { windows, frequencies }) =>
    request(`/api/content-calendar/settings/${brandId}`, {
      method: "PUT",
      body: { windows, frequencies },
    }),

  // AI Ad Creative Studio
  generateAdCreatives: ({ brandId, campaignGoal, budgetRange, productFocus }) =>
    request("/api/ad-studio/generate", {
      method: "POST",
      body: { brandId, campaignGoal, budgetRange, productFocus },
    }),
  saveAdCreative: ({ brandId, campaignGoal, packages, budgetRange, productFocus }) =>
    request("/api/ad-studio", {
      method: "POST",
      body: { brandId, campaignGoal, packages, budgetRange, productFocus },
    }),
  getAdCreatives: (brandId) => request(`/api/ad-studio/${brandId}`),
  launchAdCreative: ({ creativeId, packageIndex, budget }) =>
    request("/api/ad-studio/launch", {
      method: "POST",
      body: { creativeId, packageIndex, budget },
    }),
  getAdCreativePerformance: (brandId) =>
    request(`/api/ad-studio/performance/${brandId}`),

  // Customer Feedback & Survey System
  getFeedbackDashboard: (brandId) => request(`/api/feedback/dashboard/${brandId}`),
  getFeedbackResponses: (brandId) => request(`/api/feedback/responses/${brandId}`),
  getSurveys: (brandId) => request(`/api/feedback/surveys/${brandId}`),
  createSurvey: ({ brandId, surveyType }) =>
    request("/api/feedback/survey", {
      method: "POST",
      body: { brandId, surveyType },
    }),
  updateSurvey: (surveyId, questions) =>
    request(`/api/feedback/survey/${surveyId}`, {
      method: "PUT",
      body: { questions },
    }),
  sendSurvey: ({ surveyId, email, phone, channel, leadId }) =>
    request("/api/feedback/send", {
      method: "POST",
      body: { surveyId, email, phone, channel, leadId },
    }),
  analyzeFeedback: (brandId) =>
    request("/api/feedback/analyze", {
      method: "POST",
      body: { brandId },
    }),

  // Video content (AI Video Script & Content Creation Agent)
  generateVideoScript: ({ brandId, topic, platform, length }) =>
    request("/api/video/generate", {
      method: "POST",
      body: { brandId, topic, platform, length },
    }),
  saveVideoScript: ({ brandId, topic, platform, length, scriptContent, status }) =>
    request("/api/video/scripts", {
      method: "POST",
      body: { brandId, topic, platform, length, scriptContent, status },
    }),
  getVideoScripts: (brandId) => request(`/api/video/scripts/${brandId}`),
  deleteVideoScript: (scriptId) =>
    request(`/api/video/scripts/${scriptId}`, { method: "DELETE" }),

  // Sales scripts (AI Sales Script Generator)
  generateSalesScript: ({
    brandId,
    saleType,
    targetPersona,
    commonObjections,
    desiredOutcome,
  }) =>
    request("/api/sales-scripts/generate", {
      method: "POST",
      body: { brandId, saleType, targetPersona, commonObjections, desiredOutcome },
    }),
  saveSalesScript: ({ brandId, saleType, targetPersona, scriptContent, status }) =>
    request("/api/sales-scripts", {
      method: "POST",
      body: { brandId, saleType, targetPersona, scriptContent, status },
    }),
  getSalesScripts: (brandId) => request(`/api/sales-scripts/${brandId}`),
  updateSalesScript: (scriptId, updates) =>
    request(`/api/sales-scripts/${scriptId}`, {
      method: "PUT",
      body: updates,
    }),
  deleteSalesScript: (scriptId) =>
    request(`/api/sales-scripts/${scriptId}`, { method: "DELETE" }),

  // Zapier integration (outbound webhooks)
  listWebhooks: (brandId) => request(`/api/webhooks/${brandId}`),
  createWebhook: ({ brandId, eventName, webhookUrl }) =>
    request("/api/webhooks", {
      method: "POST",
      body: { brandId, eventName, webhookUrl },
    }),
  testWebhook: (webhookId) =>
    request("/api/webhooks/test", { method: "POST", body: { webhookId } }),
  deleteWebhook: (webhookId) =>
    request(`/api/webhooks/${webhookId}`, { method: "DELETE" }),

  // White-label agency system
  // Public: branding for the domain the dashboard is served on (no auth).
  getAgencyBranding: () =>
    request("/api/agencies/branding", { auth: false }),
  // Admin (platform owner): create agencies + all-agencies overview.
  createAgency: (payload) =>
    request("/api/agencies", { method: "POST", body: payload }),
  listAllAgencies: () => request("/api/agencies/all"),
  // Agency owner (Agency Portal): settings, customers, revenue.
  getAgencySettings: () => request("/api/agencies/settings"),
  updateAgencySettings: (payload) =>
    request("/api/agencies/settings", { method: "PUT", body: payload }),
  addAgencyCustomer: ({ customerEmail, monthlyPrice }) =>
    request("/api/agencies/customers", {
      method: "POST",
      body: { customerEmail, monthlyPrice },
    }),
  getAgencyCustomers: () => request("/api/agencies/customers"),
  getAgencyRevenue: () => request("/api/agencies/revenue"),

  // Affiliate program
  // Public: store a referral code in a cookie before signup (no auth).
  trackReferral: (code) =>
    request(`/api/affiliates/track/${encodeURIComponent(code)}`, {
      method: "POST",
      auth: false,
    }),
  joinAffiliate: () => request("/api/affiliates/register", { method: "POST" }),
  getAffiliateProfile: () => request("/api/affiliates/profile"),
  getAffiliateCommissions: () => request("/api/affiliates/commissions"),
  requestAffiliatePayout: (paypalEmail) =>
    request("/api/affiliates/payout", {
      method: "POST",
      body: { paypalEmail },
    }),
  // Admin (platform owner): overview + advancing the commission lifecycle.
  adminListAffiliates: () => request("/api/affiliates/all"),
  adminUpdateAffiliateCommissions: ({ affiliateId, action }) =>
    request("/api/affiliates/approve", {
      method: "POST",
      body: { affiliateId, action },
    }),
  adminSetAffiliateStatus: ({ affiliateId, status }) =>
    request("/api/affiliates/suspend", {
      method: "POST",
      body: { affiliateId, status },
    }),

  // Email marketing (AI Email Campaign Writer + Drip Sequence Designer)
  generateCampaignEmail: ({ brandId, goal, audienceSegment, topic }) =>
    request("/api/email-marketing/generate-email", {
      method: "POST",
      body: { brandId, goal, audienceSegment, topic },
    }),
  generateDripSequence: ({ brandId, goal, audienceSegment, numEmails }) =>
    request("/api/email-marketing/generate-drip", {
      method: "POST",
      body: { brandId, goal, audienceSegment, numEmails },
    }),
  createEmailCampaign: ({ brandId, campaignName, goal, segment, email }) =>
    request("/api/email-marketing/campaigns", {
      method: "POST",
      body: { brandId, campaignName, goal, segment, email },
    }),
  createDripCampaign: ({ brandId, campaignName, goal, segment, emails }) =>
    request("/api/email-marketing/drip", {
      method: "POST",
      body: { brandId, campaignName, goal, segment, emails },
    }),
  sendEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}/send`, { method: "POST" }),
  scheduleEmailCampaign: (campaignId, scheduledAt) =>
    request(`/api/email-marketing/campaigns/${campaignId}/schedule`, {
      method: "POST",
      body: { scheduledAt },
    }),
  unscheduleEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}/unschedule`, { method: "POST" }),
  pauseEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}/pause`, { method: "POST" }),
  resumeEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}/resume`, { method: "POST" }),
  cancelEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}`, { method: "DELETE" }),
  retryEmailDripRecipient: (campaignId, recipientId) =>
    request(
      `/api/email-marketing/campaigns/${campaignId}/recipients/${recipientId}/retry`,
      { method: "POST" }
    ),
  retryAllFailedEmailDripRecipients: (campaignId) =>
    request(
      `/api/email-marketing/campaigns/${campaignId}/recipients/retry-failed`,
      { method: "POST" }
    ),
  getEmailCampaigns: (brandId) =>
    request(`/api/email-marketing/campaigns/${brandId}`),
  getEmailCampaignDetail: (campaignId) =>
    request(`/api/email-marketing/campaign/${campaignId}`),
  getEmailContacts: (brandId) =>
    request(`/api/email-marketing/contacts/${brandId}`),
  getEmailAnalytics: (brandId) =>
    request(`/api/email-marketing/analytics/${brandId}`),

  // Image Studio (AI image generation)
  generateImage: ({ brandId, purpose, description, variations }) =>
    request("/api/images/generate", {
      method: "POST",
      body: { brandId, purpose, description, variations },
    }),
  generateAdCreativeSet: ({ brandId, campaignGoal, purpose }) =>
    request("/api/images/ad-set", {
      method: "POST",
      body: { brandId, campaignGoal, purpose },
    }),
  generateImagePrompts: ({ brandId, purpose, description }) =>
    request("/api/images/prompts", {
      method: "POST",
      body: { brandId, purpose, description },
    }),
  generateImageFromPrompt: ({ brandId, purpose, prompt }) =>
    request("/api/images/from-prompt", {
      method: "POST",
      body: { brandId, purpose, prompt },
    }),
  generateImageVariations: ({ brandId, purpose, prompt }) =>
    request("/api/images/variations", {
      method: "POST",
      body: { brandId, purpose, prompt },
    }),
  getBrandStyleGuide: (brandId) =>
    request(`/api/images/style-guide/${brandId}`),
  saveImage: ({
    brandId,
    purpose,
    prompt,
    imageUrl,
    platform,
    contentDescription,
    styleNotes,
  }) =>
    request("/api/images", {
      method: "POST",
      body: {
        brandId,
        purpose,
        prompt,
        imageUrl,
        platform,
        contentDescription,
        styleNotes,
      },
    }),
  getImages: (brandId) => request(`/api/images/${brandId}`),
  deleteImage: (imageId) =>
    request(`/api/images/${imageId}`, { method: "DELETE" }),

  // Google integration (OAuth — Business Profile, Ads, Analytics, Search Console)
  getGoogleStatus: () => request("/api/google/status"),
  // Authenticated initiation: returns the Google consent URL to navigate to.
  // Keeps the bearer token in the Authorization header (not the URL).
  startGoogleOAuth: () =>
    request("/api/google/oauth/initiate", { method: "POST" }),
  disconnectGoogle: () =>
    request("/api/google/disconnect", { method: "POST" }),
  getGoogleAnalytics: () => request("/api/google/analytics"),
  getGoogleBusinessProfile: () => request("/api/google/business-profile"),
  getGoogleAdsPerformance: () => request("/api/google/ads/performance"),
  getGoogleAdPlan: () => request("/api/google/ad-plan"),

  // SEO tools (AI SEO content + keyword research)
  generateSeoContent: ({ brandId, keyword, contentType }) =>
    request("/api/seo/generate", {
      method: "POST",
      body: { brandId, keyword, contentType },
    }),
  getKeywordSuggestions: (topic) =>
    request("/api/seo/keywords", { method: "POST", body: { topic } }),
  saveSeoContent: ({ brandId, keyword, contentType, content, seoScore }) =>
    request("/api/seo", {
      method: "POST",
      body: { brandId, keyword, contentType, content, seoScore },
    }),
  getSeoContent: (brandId) => request(`/api/seo/${brandId}`),
  deleteSeoContent: (contentId) =>
    request(`/api/seo/${contentId}`, { method: "DELETE" }),

  // Customer ROI Dashboard
  getRoi: (brandId) => request(`/api/roi/${brandId}`),
  getRoiHistory: (brandId) => request(`/api/roi/${brandId}/history`),
  generateRoiReport: (brandId) =>
    request(`/api/roi/${brandId}/report`, { method: "POST" }),

  // Advanced ROI Dashboard (Enterprise)
  getRoiAdvancedSummary: (brandId, params = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set("range", params.range);
    if (params.start) qs.set("start", params.start);
    if (params.end) qs.set("end", params.end);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/roi/${brandId}/advanced/summary${suffix}`);
  },
  generateRoiAdvancedAnalysis: (brandId, body = {}) =>
    request(`/api/roi/${brandId}/advanced/analysis`, { method: "POST", body }),
  getRoiAdvancedHistory: (brandId) =>
    request(`/api/roi/${brandId}/advanced/history`),
  getRoiAdvancedSnapshot: (brandId, snapshotId) =>
    request(`/api/roi/${brandId}/advanced/history/${snapshotId}`),

  // Customer Intelligence Engine (Enterprise)
  getIntelligenceBrief: (brandId) => request(`/api/intelligence/${brandId}/brief`),
  getIntelligenceProfile: (brandId) =>
    request(`/api/intelligence/${brandId}/profile`),
  getIntelligenceTrends: (brandId) =>
    request(`/api/intelligence/${brandId}/trends`),
  generateIntelligence: (brandId) =>
    request(`/api/intelligence/${brandId}/generate`, { method: "POST" }),
  getAppliedRecommendations: (brandId) =>
    request(`/api/intelligence/${brandId}/applied`),
  applyRecommendation: (brandId, body) =>
    request(`/api/intelligence/${brandId}/applied`, { method: "POST", body }),
  updateAppliedRecommendation: (brandId, applicationId, body) =>
    request(`/api/intelligence/${brandId}/applied/${applicationId}`, {
      method: "PATCH",
      body,
    }),

  // Portfolio — Echo, the Multi-Business Chief of Staff (owner/admin-only)
  getPortfolioOverview: () => request("/api/portfolio/overview"),
  getPortfolioHealth: () => request("/api/portfolio/health"),
  runPortfolioHealth: () => request("/api/portfolio/health/run", { method: "POST" }),
  getPortfolioIntelligence: () => request("/api/portfolio/intelligence"),
  generatePortfolioIntelligence: () =>
    request("/api/portfolio/intelligence/generate", { method: "POST" }),
  getPortfolioTeam: () => request("/api/portfolio/team"),

  // Capital & Funding Intelligence (Enterprise)
  getFundingOpportunities: (brandId) =>
    request(`/api/capital/${brandId}/opportunities`),
  scanFunding: (brandId) =>
    request(`/api/capital/${brandId}/scan`, { method: "POST" }),
  dismissFundingOpportunity: (brandId, opportunityId) =>
    request(`/api/capital/${brandId}/opportunities/${opportunityId}/dismiss`, {
      method: "POST",
    }),
  getOpportunityBriefing: (brandId) =>
    request(`/api/capital/${brandId}/briefing`),
  generateOpportunityBriefing: (brandId) =>
    request(`/api/capital/${brandId}/briefing/generate`, { method: "POST" }),
  getFundingPipeline: (brandId) => request(`/api/capital/${brandId}/pipeline`),
  draftGrantApplication: (brandId, opportunityId) =>
    request(`/api/capital/${brandId}/opportunities/${opportunityId}/draft`, {
      method: "POST",
    }),
  getGrantApplications: (brandId) =>
    request(`/api/capital/${brandId}/applications`),
  getGrantApplication: (brandId, applicationId) =>
    request(`/api/capital/${brandId}/applications/${applicationId}`),
  updateGrantApplication: (brandId, applicationId, body) =>
    request(`/api/capital/${brandId}/applications/${applicationId}`, {
      method: "PATCH",
      body,
    }),

  // Reputation Management (reviews)
  getReviews: (brandId) => request(`/api/reputation/${brandId}`),
  fetchReviews: (brandId) =>
    request(`/api/reputation/${brandId}/fetch`, { method: "POST" }),
  addReview: (brandId, body) =>
    request(`/api/reputation/${brandId}/reviews`, { method: "POST", body }),
  generateReviewResponse: (reviewId, body = {}) =>
    request(`/api/reputation/reviews/${reviewId}/generate`, {
      method: "POST",
      body,
    }),
  postReviewResponse: (reviewId, response) =>
    request(`/api/reputation/reviews/${reviewId}/respond`, {
      method: "POST",
      body: { response },
    }),
  ignoreReview: (reviewId) =>
    request(`/api/reputation/reviews/${reviewId}/ignore`, { method: "POST" }),

  // AI Phone Agent (Twilio)
  getTwilioConfig: (brandId) => request(`/api/phone/config/${brandId}`),
  saveTwilioConfig: ({ brandId, accountSid, authToken, phoneNumber }) =>
    request("/api/phone/config", {
      method: "POST",
      body: { brandId, accountSid, authToken, phoneNumber },
    }),
  deleteTwilioConfig: (brandId) =>
    request(`/api/phone/config/${brandId}`, { method: "DELETE" }),
  getCallHistory: (brandId) => request(`/api/phone/history/${brandId}`),
  initiateOutboundCall: (leadId) =>
    request("/api/phone/outbound", { method: "POST", body: { leadId } }),

  // AI Appointment Booking
  getAvailabilityConfig: (brandId) =>
    request(`/api/appointments/config/${brandId}`),
  saveAvailabilityConfig: (brandId, config) =>
    request(`/api/appointments/config/${brandId}`, {
      method: "PUT",
      body: config,
    }),
  addAvailabilityBlock: ({ brandId, startTime, endTime, reason }) =>
    request("/api/appointments/blocks", {
      method: "POST",
      body: { brandId, startTime, endTime, reason },
    }),
  deleteAvailabilityBlock: (blockId) =>
    request(`/api/appointments/blocks/${blockId}`, { method: "DELETE" }),
  getOpenSlots: (brandId, { from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/appointments/slots/${brandId}${suffix}`);
  },
  getAppointments: (brandId) => request(`/api/appointments/list/${brandId}`),
  bookAppointment: (data) =>
    request("/api/appointments", { method: "POST", body: data }),
  updateAppointment: (appointmentId, data) =>
    request(`/api/appointments/${appointmentId}`, {
      method: "PATCH",
      body: data,
    }),

  // AI Follow-Up Sequences
  generateFollowUp: ({ brandId, leadId, goal }) =>
    request("/api/follow-ups/generate", {
      method: "POST",
      body: { brandId, leadId, goal },
    }),
  saveFollowUp: ({ brandId, leadId, goal, sequenceType, touchpoints }) =>
    request("/api/follow-ups", {
      method: "POST",
      body: { brandId, leadId, goal, sequenceType, touchpoints },
    }),
  getFollowUps: (brandId, status) => {
    const qs = new URLSearchParams({ brandId });
    if (status) qs.set("status", status);
    return request(`/api/follow-ups?${qs.toString()}`);
  },
  getFollowUp: (sequenceId) => request(`/api/follow-ups/${sequenceId}`),
  pauseFollowUp: (sequenceId) =>
    request(`/api/follow-ups/${sequenceId}/pause`, { method: "POST" }),
  resumeFollowUp: (sequenceId) =>
    request(`/api/follow-ups/${sequenceId}/resume`, { method: "POST" }),
  cancelFollowUp: (sequenceId) =>
    request(`/api/follow-ups/${sequenceId}/cancel`, { method: "POST" }),

  // Two-Way SMS Marketing
  generateSmsMessages: ({ brandId, goal, audienceSegment, callToAction }) =>
    request("/api/sms/generate", {
      method: "POST",
      body: { brandId, goal, audienceSegment, callToAction },
    }),
  createSmsCampaign: ({ brandId, campaignName, messageContent, segmentFilter, leadIds, scheduledAt }) =>
    request("/api/sms/campaigns", {
      method: "POST",
      body: { brandId, campaignName, messageContent, segmentFilter, leadIds, scheduledAt },
    }),
  sendSmsCampaign: (campaignId) =>
    request(`/api/sms/campaigns/${campaignId}/send`, { method: "POST" }),
  retrySmsCampaign: (campaignId) =>
    request(`/api/sms/campaigns/${campaignId}/retry`, { method: "POST" }),
  getSmsCampaigns: (brandId) => request(`/api/sms/campaigns/${brandId}`),
  getSmsCampaignDetail: (campaignId) => request(`/api/sms/campaign/${campaignId}`),
  getSmsConversations: (brandId) => request(`/api/sms/conversations/${brandId}`),
  sendSmsReply: ({ brandId, leadId, message }) =>
    request("/api/sms/reply", {
      method: "POST",
      body: { brandId, leadId, message },
    }),
  getSmsContacts: (brandId) => request(`/api/sms/contacts/${brandId}`),
  resubscribeSmsContact: ({ brandId, phone }) =>
    request("/api/sms/resubscribe", {
      method: "POST",
      body: { brandId, phone },
    }),
  getSmsAnalytics: (brandId) => request(`/api/sms/analytics/${brandId}`),

  // AI Website Chatbot (embeddable widget)
  getChatbotConfigForOwner: (brandId) =>
    request(`/api/chatbot/admin-config/${brandId}`),
  saveChatbotConfig: ({ brandId, greeting, accentColor, avatarStyle }) =>
    request(`/api/chatbot/config/${brandId}`, {
      method: "PUT",
      body: { greeting, accentColor, avatarStyle },
    }),
  getChatbotSessions: (brandId) => request(`/api/chatbot/sessions/${brandId}`),

  // Demo request (public — landing-page visitors have no account yet)
  requestDemo: ({ name, businessType, phone, email }) =>
    request("/api/demo/request", {
      method: "POST",
      auth: false,
      body: { name, businessType, phone, email },
    }),

  // Voice landing page (public — prospects clicking a Facebook ad)
  getPublicBrand: (brandId) =>
    request(`/api/public/brand/${brandId}`, { auth: false }),
  startVoiceLead: (brandId) =>
    request("/api/public/lead/start", {
      method: "POST",
      auth: false,
      body: { brandId },
    }),
  saveLeadContact: (leadId, { name, phone, email }) =>
    request(`/api/public/lead/${leadId}/contact`, {
      method: "POST",
      auth: false,
      body: { name, phone, email },
    }),

  // Lead qualification chatbot (public — prospects are not logged in)
  leadChat: (leadId, message) =>
    request("/api/leads/chat", {
      method: "POST",
      auth: false,
      body: { leadId, message },
    }),

  // Voice chat loop (public). Sends recorded audio as multipart form data and
  // returns { transcript, reply, audio (base64), audioFormat }.
  voiceChat: async (leadId, audioBlob, voice) => {
    const form = new FormData();
    form.append("audio", audioBlob, "recording.webm");
    form.append("leadId", leadId);
    if (voice) form.append("voice", voice);

    const res = await fetch(`${BASE_URL}/api/voice/chat`, {
      method: "POST",
      body: form,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  },

  // Text-to-speech (protected). Sends { text, voice } and returns an audio Blob
  // (MP3) the caller can play. Bearer token is attached like other auth routes.
  textToSpeech: async (text, voice) => {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/voice/text-to-speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return await res.blob();
  },

  // --- Echo Voice (owner-only spoken assistant: briefings, reminders, alerts) ---
  echoVoiceGetSettings: () => request("/api/echo-voice/settings"),
  echoVoiceSaveSettings: ({ settings, firstName }) =>
    request("/api/echo-voice/settings", {
      method: "PUT",
      body: { settings, firstName },
    }),
  // Synthesize spoken text in the owner's voice style; returns an MP3 Blob.
  // Short, frequently-repeated phrases ("Paused.", "Here you go.", "Skipping
  // ahead.") are cached in memory so Echo replays them instantly instead of
  // re-synthesizing on every command. Long text (briefings) is never cached.
  echoVoiceSpeak: async (text, style, opts = {}) => {
    // In Presentation Mode the server requires ElevenLabs (no OpenAI fallback),
    // so a presentation blob must never be served from — or written to — the
    // same cache slot as a normal (possibly OpenAI) blob. Namespace by mode.
    const presentation = Boolean(opts.presentation);
    const cacheable = typeof text === "string" && text.length <= 80;
    const cacheKey = cacheable ? `${presentation ? "p" : "n"}|${style || ""}|${text}` : null;
    if (cacheKey && echoSpeakCache.has(cacheKey)) {
      return echoSpeakCache.get(cacheKey);
    }
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/echo-voice/speak`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, style, presentation }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new Event("echoai:unauthorized"));
      }
      const data = await res.json().catch(() => null);
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      // "tts_unavailable" (presentation, ElevenLabs down) lets the voice engine
      // show a text notification instead of switching to a different voice.
      if (data && data.code) err.code = data.code;
      throw err;
    }
    const blob = await res.blob();
    if (cacheKey) {
      // Bound the cache so it can't grow without limit; drop the oldest entry.
      if (echoSpeakCache.size >= 40) {
        echoSpeakCache.delete(echoSpeakCache.keys().next().value);
      }
      echoSpeakCache.set(cacheKey, blob);
    }
    return blob;
  },
  // Fetch the morning wake-up music intro (ElevenLabs). Returns an MP3 Blob, or
  // null when there's no intro to play (204 / any error) so the caller skips it.
  echoVoiceWakeupIntro: async () => {
    // Abort after 8s so a hung network can never block the morning briefing.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BASE_URL}/api/echo-voice/wakeup-intro`, {
        headers,
        signal: ctrl.signal,
      });
      if (res.status === 204 || !res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
  // Fetch a named personality sound effect (wake/goodbye/thinking/hotlead/
  // celebration/error). Returns an MP3 Blob, or null (204/error) so callers skip.
  echoVoiceSound: async (name) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BASE_URL}/api/echo-voice/sound/${encodeURIComponent(name)}`, {
        headers,
        signal: ctrl.signal,
      });
      if (res.status === 204 || !res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
  echoVoiceGetBriefing: () => request("/api/echo-voice/briefing"),
  echoVoiceMarkBriefingDelivered: () =>
    request("/api/echo-voice/briefing/delivered", { method: "POST" }),
  echoVoiceGetWeekly: () => request("/api/echo-voice/weekly-briefing"),
  echoVoiceDecideSuggestion: (key, decision) =>
    request(`/api/echo-voice/suggestions/${encodeURIComponent(key)}/decision`, {
      method: "POST",
      body: { decision },
    }),
  echoVoiceGetStatus: () => request("/api/echo-voice/status"),
  echoVoiceGetLearnedPhrases: () => request("/api/echo-voice/learned-phrases"),
  echoVoiceLearnPhrase: (phrase, action) =>
    request("/api/echo-voice/learned-phrases", {
      method: "POST",
      body: { phrase, action },
    }),
  echoVoiceGetPending: (clientHour) =>
    request(
      `/api/echo-voice/pending${
        Number.isInteger(clientHour) ? `?clientHour=${clientHour}` : ""
      }`,
    ),
  echoVoiceMarkNotification: (id, status) =>
    request(`/api/echo-voice/notifications/${id}/delivered`, {
      method: "POST",
      body: status ? { status } : {},
    }),

  // --- AI Health Monitor + Screenshot Support ---
  healthGetStatus: (brandId) =>
    request(`/api/health-monitor/${brandId}/status`),
  healthRunCheck: (brandId) =>
    request(`/api/health-monitor/${brandId}/check`, { method: "POST" }),
  healthGetHistory: (brandId) =>
    request(`/api/health-monitor/${brandId}/history`),
  // Platform-level API credit / quota levels (admin-only).
  healthGetApiCredits: () => request("/api/health-monitor/api-credits"),
  healthRefreshApiCredits: () =>
    request("/api/health-monitor/api-credits/refresh", { method: "POST" }),
  submitSupportTicket: ({ brandId, description, screenshot }) =>
    request("/api/health-monitor/support", {
      method: "POST",
      body: { brandId, description, screenshot },
    }),
  listSupportTickets: () => request("/api/health-monitor/support"),
  submitPublicSupportTicket: ({ description, screenshot }) =>
    request("/api/public/support", {
      method: "POST",
      auth: false,
      body: { description, screenshot },
    }),
  adminGetAccountsHealth: () => request("/api/admin/health/accounts"),

  // --- AI Sales Agent (admin only) ---
  salesGetConfig: () => request("/api/sales-agent/config"),
  salesSaveConfig: (payload) =>
    request("/api/sales-agent/config", { method: "PUT", body: payload }),
  salesGetCalls: () => request("/api/sales-agent/calls"),
  salesGetLiveCalls: () => request("/api/sales-agent/live"),
  salesGetPerformance: () => request("/api/sales-agent/performance"),
  salesGetCall: (callId) => request(`/api/sales-agent/calls/${callId}`),
  salesInvite: (callId) =>
    request(`/api/sales-agent/calls/${callId}/invite`, { method: "POST" }),
  salesAskEcho: ({ callId, question }) =>
    request(`/api/sales-agent/calls/${callId}/ask-echo`, {
      method: "POST",
      body: { question },
    }),
  salesBookDemo: (callId) =>
    request(`/api/sales-agent/calls/${callId}/book-demo`, { method: "POST" }),

  // Speech-to-text (protected). Sends recorded audio as multipart form data and
  // returns { text }. Content-Type is left unset so the browser adds the
  // multipart boundary.
  speechToText: async (audioBlob) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const form = new FormData();
    form.append("audio", audioBlob, "recording.webm");
    const res = await fetch(`${BASE_URL}/api/voice/speech-to-text`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // Setup Agent voice-input fallback (protected). Used only when the browser has
  // no Web Speech API: sends the recorded answer as multipart audio and returns
  // { text }. Content-Type is left unset so the browser adds the multipart
  // boundary.
  transcribeSetupVoice: async (audioBlob) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const form = new FormData();
    form.append("audio", audioBlob, "answer.webm");
    const res = await fetch(`${BASE_URL}/api/setup-agent/transcribe`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
};
