// Client-side persistence for an affiliate referral code. The landing page reads
// ?ref= from the URL and stores it here so it survives the navigation to the
// signup form; register() then sends it to the server for attribution.

const REF_KEY = "echoai_ref";

export function setReferralCode(code) {
  if (code) localStorage.setItem(REF_KEY, code);
}

export function getReferralCode() {
  return localStorage.getItem(REF_KEY) || "";
}

export function clearReferralCode() {
  localStorage.removeItem(REF_KEY);
}
