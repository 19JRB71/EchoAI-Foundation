import Constants from "expo-constants";

/**
 * Base URL of the EchoAI backend (the single-origin server that serves both the
 * web app and the API). Override per-environment via:
 *   - EXPO_PUBLIC_API_URL env var, or
 *   - the `extra.apiUrl` field in app.json.
 *
 * The mobile API lives under `${API_URL}/api/v2`.
 */
const fromExtra = Constants?.expoConfig?.extra?.apiUrl;

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || fromExtra || "https://your-echoai-domain.example.com";

export const API_V2 = `${API_URL}/api/v2`;

// AsyncStorage keys.
export const STORAGE_KEYS = {
  accessToken: "echoai.accessToken",
  refreshToken: "echoai.refreshToken",
  biometricToken: "echoai.biometricToken",
  user: "echoai.user",
};
