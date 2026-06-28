import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, API_V2, STORAGE_KEYS } from "../config";

/**
 * Thin fetch wrapper around the EchoAI mobile API (`/api/v2`).
 *
 * - Parses the standard envelope { status, data, message, pagination }.
 * - Attaches the Bearer access token on protected calls.
 * - On a 401, transparently attempts a single refresh-token rotation and
 *   retries the original request once.
 *
 * Errors are thrown as `ApiError` so screens can show `error.message` and
 * branch on `error.status` (HTTP code).
 */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message || "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function getAccessToken() {
  return AsyncStorage.getItem(STORAGE_KEYS.accessToken);
}

async function getRefreshToken() {
  return AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
}

export async function saveSession({ token, refreshToken, user }) {
  const ops = [];
  if (token) ops.push(AsyncStorage.setItem(STORAGE_KEYS.accessToken, token));
  if (refreshToken)
    ops.push(AsyncStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken));
  if (user)
    ops.push(AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user)));
  await Promise.all(ops);
}

export async function clearSession() {
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.user,
  ]);
}

let refreshInFlight = null;

/**
 * Exchange the stored refresh token for a new access token (single-use rotation).
 * De-duplicates concurrent refreshes so a burst of 401s triggers only one call.
 */
async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return false;

    const res = await fetch(`${API_V2}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== "success") {
      await clearSession();
      return false;
    }
    await saveSession({
      token: json.data.token,
      refreshToken: json.data.refreshToken,
    });
    return true;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function rawRequest(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_V2}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response (shouldn't happen on /api/v2, but be defensive).
    throw new ApiError(`Unexpected response (${res.status})`, res.status, null);
  }

  if (!res.ok || json.status === "error") {
    throw new ApiError(json?.message || "Request failed", res.status, json?.data);
  }
  return json; // { status, data, message, pagination }
}

/**
 * Public request method with automatic 401 → refresh → retry-once handling.
 */
export async function request(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (err) {
    const isAuthCall = path.startsWith("/auth/");
    if (err instanceof ApiError && err.status === 401 && options.auth !== false && !isAuthCall) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return rawRequest(path, options);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Endpoint helpers                                                    */
/* ------------------------------------------------------------------ */

export const authApi = {
  login: (email, password, device = {}) =>
    request("/auth/login", { method: "POST", auth: false, body: { email, password, ...device } }),

  register: (payload) =>
    request("/auth/register", { method: "POST", auth: false, body: payload }),

  refresh: (refreshToken) =>
    request("/auth/refresh", { method: "POST", auth: false, body: { refreshToken } }),

  // Mints a short-lived biometric token for the current (logged-in) session.
  createBiometricToken: () => request("/auth/biometric", { method: "POST" }),

  biometricLogin: (biometricToken, device = {}) =>
    request("/auth/biometric/login", {
      method: "POST",
      auth: false,
      body: { biometricToken, ...device },
    }),

  logout: (refreshToken) =>
    request("/auth/logout", { method: "POST", body: { refreshToken } }),
};

export const pushApi = {
  register: (pushToken, platform, device = {}) =>
    request("/push/register", { method: "POST", body: { pushToken, platform, ...device } }),

  unregister: (pushToken) =>
    request("/push/register", { method: "DELETE", body: { pushToken } }),
};

/**
 * Legacy (web) `/api` endpoints the mobile app reuses until a v2 equivalent
 * exists. The 30-day mobile access token authorizes these too. Returns the raw
 * legacy JSON (NOT the v2 envelope).
 */
async function legacyGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return legacyGet(path);
  }
  if (!res.ok) throw new ApiError(json?.error || json?.message || "Request failed", res.status, json);
  return json;
}

export const legacyApi = {
  // Brand list, used to scope the v2 dashboard/leads screens.
  brands: async () => {
    const json = await legacyGet("/brands");
    // Be defensive about the legacy shape.
    return json?.brands || json?.data || (Array.isArray(json) ? json : []);
  },
};

export const dataApi = {
  dashboard: (brandId) => request(`/dashboard/${brandId}`),

  leads: ({ brandId, temperature, cursor, limit } = {}) => {
    const params = new URLSearchParams();
    if (brandId) params.set("brandId", brandId);
    if (temperature) params.set("temperature", temperature);
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return request(`/leads${qs ? `?${qs}` : ""}`);
  },
};
