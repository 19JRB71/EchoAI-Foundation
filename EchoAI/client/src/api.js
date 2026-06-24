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

  // Subscription
  getSubscriptionStatus: () => request("/api/subscriptions/status"),
  cancelSubscription: () =>
    request("/api/subscriptions/cancel", { method: "POST" }),

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

  // Analytics
  getAnalytics: (brandId) => request(`/api/analytics/${brandId}`),
  getCurrentWeek: (brandId) => request(`/api/analytics/${brandId}/current`),
};
