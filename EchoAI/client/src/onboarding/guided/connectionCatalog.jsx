// Configuration-driven catalog of the connections offered in Guided Setup.
//
// Adding a future integration = add one entry here (plus a status probe in the
// server's guidedSetupController and a preview illustration in ./previews/).
// Nothing in the wizard hard-codes a provider.

import { api } from "../../api.js";
import facebookPreview from "./previews/facebook-preview.svg";
import googlePreview from "./previews/google-preview.svg";

export function FacebookLogo({ className = "h-10 w-10" }) {
  return (
    <span
      className={`${className} flex items-center justify-center rounded-full bg-[#1877f2] text-xl font-black text-white`}
      aria-hidden="true"
    >
      f
    </span>
  );
}

export function GoogleLogo({ className = "h-10 w-10" }) {
  return (
    <span
      className={`${className} flex items-center justify-center rounded-full bg-white text-xl font-black`}
      aria-hidden="true"
    >
      <span className="bg-gradient-to-br from-[#4285F4] via-[#EA4335] to-[#34A853] bg-clip-text text-transparent">
        G
      </span>
    </span>
  );
}

export const CONNECTION_CATALOG = [
  {
    key: "facebook",
    name: "Facebook",
    // OAuth-return URL params set by the server's callback redirect.
    paramKey: "fb",
    messageKey: "fb_message",
    Logo: FacebookLogo,
    benefit:
      "Connect Facebook so Nova can publish posts, create ads, and manage your social media automatically.",
    previewImage: facebookPreview,
    previewInstruction:
      "Facebook will open next. Sign in if it asks, then press the blue button — I'll be right here when you get back.",
    start: () => api.startFacebookOAuth(),
  },
  {
    key: "google",
    name: "Google",
    paramKey: "google",
    messageKey: "google_message",
    Logo: GoogleLogo,
    benefit:
      "Connect Google so Echo can monitor Gmail, manage your calendar, schedule appointments, and organize important emails.",
    previewImage: googlePreview,
    previewInstruction:
      "Google will open next. Pick the account your business uses, then press Allow — I'll be right here when you get back.",
    start: () => api.startGoogleOAuth(),
  },
];
