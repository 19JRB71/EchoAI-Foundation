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
  register: (email, password, teamSize) =>
    request("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password, teamSize },
    }),
  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    }),
  getProfile: () => request("/api/auth/profile"),
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
  getPaymentMethod: () => request("/api/subscriptions/payment-method"),
  updatePaymentMethod: (paymentMethodId) =>
    request("/api/subscriptions/payment-method", {
      method: "POST",
      body: { paymentMethodId },
    }),
  getBillingHistory: () => request("/api/subscriptions/invoices"),
  getUpcomingInvoice: () => request("/api/subscriptions/upcoming-invoice"),

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

  // Email marketing (AI Email Campaign Agent)
  generateEmailSequence: ({ brandId, goal, targetAudience, numEmails }) =>
    request("/api/email-campaigns/generate", {
      method: "POST",
      body: { brandId, goal, targetAudience, numEmails },
    }),
  saveEmailCampaign: ({ brandId, campaignName, goal, emailSequence }) =>
    request("/api/email-campaigns", {
      method: "POST",
      body: { brandId, campaignName, goal, emailSequence },
    }),
  sendEmailCampaign: (campaignId) =>
    request(`/api/email-campaigns/${campaignId}/send`, { method: "POST" }),
  getEmailCampaigns: (brandId) => request(`/api/email-campaigns/${brandId}`),
  getEmailCampaignPerformance: (brandId) =>
    request(`/api/email-campaigns/performance/${brandId}`),

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
  saveImage: ({ brandId, purpose, prompt, imageUrl, platform }) =>
    request("/api/images", {
      method: "POST",
      body: { brandId, purpose, prompt, imageUrl, platform },
    }),
  getImages: (brandId) => request(`/api/images/${brandId}`),
  deleteImage: (imageId) =>
    request(`/api/images/${imageId}`, { method: "DELETE" }),

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
};
