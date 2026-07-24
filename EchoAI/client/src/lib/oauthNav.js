// Google/Facebook refuse to render their sign-in pages inside an embedded
// frame (e.g. the staging preview iframe → Google shows a bare 403). When the
// app is framed, OAuth must open in a real browser tab instead of navigating
// the frame.

/** True when the app is running inside an iframe (cross-origin safe). */
export function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin top access throws → we ARE framed
  }
}

/**
 * Navigate to an OAuth authorization URL. Returns true when we navigated the
 * current page away (caller should leave its button disabled), false when the
 * flow opened in a new tab (caller should re-enable its UI).
 */
export function openAuthUrl(authUrl) {
  if (isEmbedded()) {
    window.open(authUrl, "_blank", "noopener");
    return false;
  }
  window.location.href = authUrl;
  return true;
}
