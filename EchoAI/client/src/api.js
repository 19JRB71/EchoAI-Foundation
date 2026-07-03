// Thin fetch wrapper around the EchoAI backend. Stores the JWT in localStorage
// and attaches it as a Bearer token on protected routes.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const TOKEN_KEY = "echoai_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
  register: (email, password, teamSize, referralCode) =>
    request("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password, teamSize, referralCode },
    }),
  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    }),
  getProfile: () => request("/api/auth/profile"),

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
  dismissSetupSession: (sessionId) =>
    request("/api/setup-agent/dismiss", { method: "POST", body: { sessionId } }),

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
  inviteTeamMember: (email, role) =>
    request("/api/team/invite", { method: "POST", body: { email, role } }),
  resendTeamInvite: (teamMemberId) =>
    request("/api/team/resend", { method: "POST", body: { teamMemberId } }),
  changeTeamRole: (teamMemberId, role) =>
    request("/api/team/role", { method: "PUT", body: { teamMemberId, role } }),
  removeTeamMember: (teamMemberId) =>
    request(`/api/team/${teamMemberId}`, { method: "DELETE" }),
  acceptTeamInvite: (token) =>
    request("/api/team/accept", { method: "POST", body: { token } }),

  // Brands
  getBrands: () => request("/api/brands"),
  getBrand: (brandId) => request(`/api/brands/${brandId}`),
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
  pauseEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}/pause`, { method: "POST" }),
  resumeEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}/resume`, { method: "POST" }),
  cancelEmailCampaign: (campaignId) =>
    request(`/api/email-marketing/campaigns/${campaignId}`, { method: "DELETE" }),
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
};
