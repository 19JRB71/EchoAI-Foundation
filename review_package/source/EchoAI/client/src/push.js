/* Client-side push-notification + service-worker helpers.
 *
 * - registerServiceWorker(): registers /sw.js so the app shell is cached and the
 *   app can receive push events. Safe to call on every load.
 * - enablePushNotifications(token): requests notification permission (on first
 *   login), subscribes via the Web Push API using the server's VAPID public key,
 *   and sends the subscription to the backend.
 *
 * Everything is best-effort and gracefully no-ops when the browser lacks support
 * or push isn't configured on the server — it never throws into the caller.
 */

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;
const SW_SCOPE = import.meta.env.BASE_URL;
const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch (err) {
    console.warn("Service worker registration failed:", err.message);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getVapidPublicKey(token) {
  const res = await fetch(`${API}/api/push/vapid-public-key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.publicKey || null;
}

/**
 * Ask for permission and subscribe the current device to push. Returns true when
 * a subscription was created and saved, false otherwise. Never throws.
 */
export async function enablePushNotifications(token) {
  if (!pushSupported() || !token) return false;

  try {
    // Don't re-prompt users who already denied.
    if (Notification.permission === "denied") return false;

    const publicKey = await getVapidPublicKey(token);
    if (!publicKey) return false; // push not configured on the server

    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg =
      (await navigator.serviceWorker.getRegistration(SW_SCOPE)) ||
      (await registerServiceWorker());
    if (!reg) return false;
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const res = await fetch(`${API}/api/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ subscription: sub }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Push subscription failed:", err.message);
    return false;
  }
}
