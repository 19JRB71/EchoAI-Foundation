// Plain-English translation of OAuth / connection failures.
//
// The customer NEVER sees raw developer errors — the raw provider message is
// reported to the server for logging (see reportGuidedSetupConnectionError)
// and the wizard shows only these friendly explanations with the simplest
// next action. Every failure offers Try Again / Help Me / Skip for Now.

const PROVIDER_LABELS = { facebook: "Facebook", google: "Google" };

function label(provider) {
  return PROVIDER_LABELS[provider] || "the service";
}

// Ordered: first matching rule wins. Keep patterns in sync with the messages
// the OAuth callbacks put in fb_message / google_message.
const RULES = [
  {
    key: "denied",
    test: /denied|declined|access_denied|not granted|permission|consent/i,
    title: "Permission wasn't given",
    body: (p) =>
      `It looks like the permission step on ${p} was declined. That's completely fine — nothing is broken.`,
    action: (p) =>
      `Try again, and when ${p} asks, press Allow (or Continue) so Echo can work for you.`,
  },
  {
    key: "no_page",
    test: /no .*page|page.*not found|not (an? )?admin|no pages|manage.*page/i,
    title: "No business Page found",
    body: (p) =>
      `${p} says the account you signed in with doesn't manage a business Page (or isn't an admin of one).`,
    action: (p) =>
      `Sign in with the account that runs your business Page on ${p} and try again — or skip this for now.`,
  },
  {
    key: "wrong_account",
    test: /wrong account|different account|another account|account mismatch/i,
    title: "That looks like a different account",
    body: () =>
      "You may have been signed in with a personal or different account than the one your business uses.",
    action: (p) => `Try again and pick your business account when ${p} asks which one to use.`,
  },
  {
    key: "expired",
    test: /state|expired|session|csrf|timed? ?out/i,
    title: "The sign-in took a little too long",
    body: () =>
      "The secure sign-in link expired before it finished — this happens if the window sits open for a while.",
    action: () => "Just try again — it usually works on the second go.",
  },
  {
    key: "popup_blocked",
    test: /popup|blocked/i,
    title: "Your browser blocked the window",
    body: () => "Your browser stopped the sign-in window from opening.",
    action: () =>
      "Look for a small \"popup blocked\" notice near the address bar, allow popups for this site, then try again.",
  },
  {
    key: "cancelled",
    test: /cancel|closed|abort|interrupted/i,
    title: "The window was closed early",
    body: (p) => `The ${p} window closed before the connection finished. No harm done.`,
    action: () => "Whenever you're ready, just try again and follow it through to the end.",
  },
  {
    key: "not_configured",
    test: /not configured|unavailable|not set up|503/i,
    title: "This connection isn't available right now",
    body: (p) => `Connecting ${p} isn't switched on for this account at the moment.`,
    action: () => "Skip this for now — you can always connect it later from Settings.",
  },
];

/**
 * Turns a raw provider/OAuth failure message into friendly copy.
 * Always returns { key, title, body, action } — falls back to a generic,
 * honest "provider hiccup" explanation when nothing matches.
 */
export function translateConnectionError(provider, rawMessage) {
  const p = label(provider);
  const raw = String(rawMessage || "");
  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      return {
        key: rule.key,
        title: rule.title,
        body: rule.body(p),
        action: rule.action(p),
      };
    }
  }
  return genericError(p);
}

function genericError(p) {
  return {
    key: "provider_error",
    title: `${p} hit a snag`,
    body: `Something went wrong on ${p}'s side while connecting. This usually isn't anything you did.`,
    action: "Try again in a moment. If it keeps happening, tap Help Me and I'll take a look with you.",
  };
}

/**
 * Rebuilds the friendly copy from a persisted errorKey (the wizard stores only
 * the key server-side, never raw provider text), so the same explanation
 * survives a page reload.
 */
export function errorCopyForKey(provider, key) {
  const p = label(provider);
  const rule = RULES.find((r) => r.key === key);
  if (!rule) return genericError(p);
  return { key: rule.key, title: rule.title, body: rule.body(p), action: rule.action(p) };
}
