import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "../api";
import { useVoice } from "../voice/VoiceContext.jsx";

// ---------------------------------------------------------------------------
// Facebook Setup Wizard
//
// A plain-English, mobile-responsive, resumable wizard that walks a business
// owner through connecting their Facebook Business account to EchoAI. It lives
// in Atlas's department ("Connect Facebook") and branches based on where the
// owner already is:
//   welcome → questions → [Business Manager] → [Ad Account] → [Page↔Account]
//           → connect (real OAuth) → verify/test → launch first campaign
// Bracketed steps only appear when the owner says they haven't done them yet.
//
// Progress is saved to localStorage so a returning owner (including after the
// Facebook OAuth redirect) resumes exactly where they left off. Echo speaks a
// friendly line at each key milestone.
// ---------------------------------------------------------------------------

const FB = "#1877f2";
const STORAGE_KEY = "echoai_fb_wizard_v1";

// Every possible step, in order. `optional` steps are only shown when their
// condition (below, in useActiveSteps) is met.
const ALL_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "questions", label: "A few quick questions" },
  { id: "bm", label: "Create Business Manager" },
  { id: "adaccount", label: "Create Ad Account" },
  { id: "page", label: "Connect your Page" },
  { id: "connect", label: "Connect to EchoAI" },
  { id: "verify", label: "Verify connection" },
  { id: "launch", label: "Launch first campaign" },
];

// Echo's voice line for the moment the owner *arrives* at a step.
const VOICE_LINES = {
  welcome: "Let's get your Facebook connected so Atlas can start bringing you leads.",
  adaccount: "Perfect — your business is now verified on Facebook.",
  page: "Excellent — your ad account is ready.",
  verify: "You're now connected to Facebook. Atlas is ready to go to work for you.",
};

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

// ---- small presentational helpers -----------------------------------------

// A faux "screenshot" frame with an arrow pointing at the button the owner
// should click. Keeps a non-technical owner oriented without shipping real
// (and quickly-stale) Facebook screenshots.
function ScreenshotHint({ browserBar = "business.facebook.com", pointTo }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900">
      <div className="flex items-center gap-1.5 border-b border-gray-800 bg-gray-950 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
        <span className="ml-2 truncate rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-400">
          {browserBar}
        </span>
      </div>
      <div className="relative flex h-24 items-center justify-end p-3">
        <div className="absolute left-3 top-3 h-3 w-20 rounded bg-gray-800" />
        <div className="absolute left-3 top-8 h-2 w-28 rounded bg-gray-800/70" />
        <div className="flex items-center gap-2">
          <svg className="h-6 w-10 text-blue-400" viewBox="0 0 40 24" fill="none">
            <path
              d="M2 12h30m0 0l-7-6m7 6l-7 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow"
            style={{ backgroundColor: FB }}
          >
            {pointTo}
          </span>
        </div>
      </div>
    </div>
  );
}

function NumberedSteps({ items }) {
  return (
    <ol className="mt-4 space-y-2.5">
      {items.map((text, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-gray-300">
          <span
            className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: FB }}
          >
            {i + 1}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

function YesNo({ value, onChange }) {
  const base =
    "flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition min-h-[48px]";
  return (
    <div className="mt-2 flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`${base} ${
          value === true
            ? "border-transparent bg-emerald-500 text-white"
            : "border-gray-700 text-gray-300 hover:bg-gray-800"
        }`}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`${base} ${
          value === false
            ? "border-transparent bg-gray-600 text-white"
            : "border-gray-700 text-gray-300 hover:bg-gray-800"
        }`}
      >
        Not yet
      </button>
    </div>
  );
}

// ---- main component --------------------------------------------------------

export default function FacebookWizard({
  onClose,
  brandId,
  startAtVerify = false,
  oauthError = "",
}) {
  const voice = useVoice();
  const enqueue = voice?.enqueue;
  const spokenRef = useRef(new Set());

  const saved = useMemo(() => readSaved(), []);
  const [answers, setAnswers] = useState(
    saved?.answers || {
      hasFacebook: null,
      hasBusinessManager: null,
      hasAdAccount: null,
    },
  );
  const [stepId, setStepId] = useState(
    oauthError
      ? "connect"
      : startAtVerify
        ? "verify"
        : saved?.stepId || "welcome",
  );

  // Which steps are active given the owner's answers. Optional setup steps only
  // appear when the owner hasn't done them; connect/verify/launch are always on.
  const activeSteps = useMemo(() => {
    return ALL_STEPS.filter((s) => {
      if (s.id === "bm") return answers.hasBusinessManager === false;
      if (s.id === "adaccount") return answers.hasAdAccount === false;
      if (s.id === "page") return answers.hasAdAccount === false;
      return true;
    });
  }, [answers]);

  const idx = Math.max(
    0,
    activeSteps.findIndex((s) => s.id === stepId),
  );
  const current = activeSteps[idx] || activeSteps[0];
  const pct = Math.round(((idx + 1) / activeSteps.length) * 100);

  // Persist progress so the owner can resume after closing or the OAuth redirect.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ answers, stepId }));
    } catch {
      /* storage may be unavailable; resume just won't work */
    }
  }, [answers, stepId]);

  // Speak Echo's line for the current step, once.
  useEffect(() => {
    const line = VOICE_LINES[current?.id];
    if (!line || !enqueue || spokenRef.current.has(current.id)) return;
    spokenRef.current.add(current.id);
    enqueue({ type: "status", title: "Facebook Setup", text: line });
  }, [current, enqueue]);

  const goNext = useCallback(() => {
    setStepId((cur) => {
      const list = activeSteps;
      const i = list.findIndex((s) => s.id === cur);
      return list[Math.min(list.length - 1, i + 1)]?.id || cur;
    });
  }, [activeSteps]);

  const goBack = useCallback(() => {
    setStepId((cur) => {
      const list = activeSteps;
      const i = list.findIndex((s) => s.id === cur);
      return list[Math.max(0, i - 1)]?.id || cur;
    });
  }, [activeSteps]);

  const finish = useCallback(() => {
    clearSaved();
    onClose?.();
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-gray-700 bg-gray-950 shadow-2xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="h-1.5 w-full flex-none bg-gray-800">
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: FB }}
          />
        </div>

        {/* Header */}
        <div className="flex flex-none items-center justify-between px-5 pt-4">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: FB }}
          >
            Connect Facebook · Step {idx + 1} of {activeSteps.length}
          </span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable step body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <StepBody
            stepId={current?.id}
            answers={answers}
            setAnswers={setAnswers}
            brandId={brandId}
            enqueue={enqueue}
            spokenRef={spokenRef}
            goNext={goNext}
            finish={finish}
            oauthError={oauthError}
          />
        </div>

        {/* Footer nav — steps that own their CTA (questions/connect/verify/launch)
            render it inside the body, so we only show Back + a generic Next for
            the purely instructional steps. */}
        <WizardFooter
          stepId={current?.id}
          canBack={idx > 0}
          onBack={goBack}
          onNext={goNext}
        />
      </div>
    </div>
  );
}

// Instructional steps (welcome/bm/adaccount/page) advance with a generic
// Back/Continue footer. Interactive steps render their own actions in the body.
const BODY_OWNS_CTA = new Set(["questions", "connect", "verify", "launch"]);

function WizardFooter({ stepId, canBack, onBack, onNext }) {
  if (BODY_OWNS_CTA.has(stepId)) {
    if (!canBack) return null;
    return (
      <div className="flex-none border-t border-gray-800 px-5 py-3">
        <button
          onClick={onBack}
          className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
        >
          Back
        </button>
      </div>
    );
  }

  const nextLabel =
    stepId === "welcome"
      ? "Let's start"
      : stepId === "bm" || stepId === "adaccount" || stepId === "page"
        ? "I've completed this step"
        : "Continue";

  return (
    <div className="flex flex-none items-center gap-3 border-t border-gray-800 px-5 py-3">
      {canBack && (
        <button
          onClick={onBack}
          className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
        >
          Back
        </button>
      )}
      <button
        onClick={onNext}
        className="flex-1 rounded-lg py-3 text-sm font-bold text-white"
        style={{ backgroundColor: FB }}
      >
        {nextLabel}
      </button>
    </div>
  );
}

// ---- per-step bodies -------------------------------------------------------

function StepBody(props) {
  switch (props.stepId) {
    case "welcome":
      return <WelcomeStep />;
    case "questions":
      return <QuestionsStep {...props} />;
    case "bm":
      return <BusinessManagerStep />;
    case "adaccount":
      return <AdAccountStep />;
    case "page":
      return <PageConnectStep />;
    case "connect":
      return <ConnectStep oauthError={props.oauthError} />;
    case "verify":
      return <VerifyStep goNext={props.goNext} />;
    case "launch":
      return <LaunchStep brandId={props.brandId} enqueue={props.enqueue} finish={props.finish} />;
    default:
      return null;
  }
}

function StepHeading({ title, subtitle }) {
  return (
    <div className="mb-1">
      <h3 className="text-lg font-bold text-gray-100">{title}</h3>
      {subtitle && <p className="mt-1 text-sm leading-relaxed text-gray-400">{subtitle}</p>}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-900">
        <svg className="h-9 w-9" viewBox="0 0 24 24" fill={FB}>
          <path d="M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0022 12z" />
        </svg>
      </div>
      <h3 className="mt-4 text-xl font-bold text-gray-100">Let's connect Facebook</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-400">
        I'll walk you through every step in plain English — no technical
        knowledge needed. Once we're done, Atlas can start running ads and
        bringing you leads. This takes about 5 minutes.
      </p>
      <p className="mt-4 text-xs text-gray-500">
        You can close this anytime and pick up right where you left off.
      </p>
    </div>
  );
}

function QuestionsStep({ answers, setAnswers, goNext }) {
  const set = (key) => (val) => setAnswers((a) => ({ ...a, [key]: val }));
  const allAnswered =
    answers.hasFacebook !== null &&
    answers.hasBusinessManager !== null &&
    answers.hasAdAccount !== null;

  return (
    <div>
      <StepHeading
        title="A few quick questions"
        subtitle="This tells me exactly where you are so I only show you the steps you actually need."
      />

      <div className="mt-4 space-y-5">
        <div>
          <p className="text-sm font-medium text-gray-200">
            Do you have a Facebook account?
          </p>
          <YesNo value={answers.hasFacebook} onChange={set("hasFacebook")} />
          {answers.hasFacebook === false && (
            <p className="mt-2 text-xs text-amber-300/90">
              No problem — you'll be able to create one on Facebook's screen when
              we get to the connect step.
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-gray-200">
            Do you have a Facebook Business Manager account?
          </p>
          <p className="text-xs text-gray-500">This is the tool at business.facebook.com.</p>
          <YesNo
            value={answers.hasBusinessManager}
            onChange={set("hasBusinessManager")}
          />
        </div>

        <div>
          <p className="text-sm font-medium text-gray-200">
            Do you have a Facebook Ad Account set up for this business?
          </p>
          <YesNo value={answers.hasAdAccount} onChange={set("hasAdAccount")} />
        </div>
      </div>

      <button
        onClick={goNext}
        disabled={!allAnswered}
        className="mt-6 w-full rounded-lg py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        style={{ backgroundColor: FB }}
      >
        Continue
      </button>
      {!allAnswered && (
        <p className="mt-2 text-center text-xs text-gray-500">
          Answer all three to continue.
        </p>
      )}
    </div>
  );
}

function BusinessManagerStep() {
  return (
    <div>
      <StepHeading
        title="Create your Business Manager"
        subtitle="Business Manager is Facebook's free hub for running ads. Let's set yours up."
      />
      <div className="mt-4">
        <ScreenshotHint browserBar="business.facebook.com" pointTo="Create account" />
      </div>
      <NumberedSteps
        items={[
          "Open a new browser tab and go to business.facebook.com.",
          "Click Create account in the top-right corner.",
          "Enter your business name, your name, and your business email address.",
          "Click Submit.",
          "Check your email and click the link to verify your business account.",
        ]}
      />
      <p className="mt-4 text-xs text-gray-500">
        Come back here and tap the button below once you've finished.
      </p>
    </div>
  );
}

function AdAccountStep() {
  return (
    <div>
      <StepHeading
        title="Create your Ad Account"
        subtitle="You're now inside Business Manager. Let's create the ad account your ads will run from."
      />
      <div className="mt-4">
        <ScreenshotHint browserBar="business.facebook.com › Settings" pointTo="Create a New Ad Account" />
      </div>
      <NumberedSteps
        items={[
          "Click Settings in the left sidebar.",
          "Under Accounts, click Ad Accounts.",
          "Click Add, then Create a New Ad Account.",
          "Name the ad account after your business (e.g. \"Blacor Homes Ads\").",
          "Select your time zone and currency.",
          "Click Create Ad Account.",
          "Add a payment method: click Add Payment Method and enter your card details.",
        ]}
      />
      <p className="mt-4 text-xs text-gray-500">
        Tap the button below once your ad account is created.
      </p>
    </div>
  );
}

function PageConnectStep() {
  return (
    <div>
      <StepHeading
        title="Connect your Page to the Ad Account"
        subtitle="Your ads run from a Facebook Page. Let's link your business Page to the ad account."
      />
      <div className="mt-4">
        <ScreenshotHint browserBar="business.facebook.com › Settings › Pages" pointTo="Add Assets" />
      </div>
      <NumberedSteps
        items={[
          "Go to Business Settings.",
          "Under Accounts, click Pages.",
          "Click Add, then Add a Page.",
          "Enter your Facebook Page name or URL and click Add Page.",
          "Go to Ad Accounts and select your ad account.",
          "Click Add Assets, choose Pages, and connect your business Page.",
        ]}
      />
      <p className="mt-4 text-xs text-gray-500">
        Don't have a Facebook Page yet? Create one at facebook.com/pages/create,
        then come back and finish this step.
      </p>
    </div>
  );
}

function ConnectStep({ oauthError = "" }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(oauthError);

  async function handleConnect() {
    setConnecting(true);
    setError("");
    try {
      const { authUrl } = await api.startFacebookOAuth();
      if (authUrl) {
        window.location.href = authUrl;
      } else {
        throw new Error("Couldn't start the Facebook connection.");
      }
    } catch (e) {
      setError(e.message || "Couldn't start the Facebook connection.");
      setConnecting(false);
    }
  }

  return (
    <div className="text-center">
      <StepHeading
        title="Connect Facebook to EchoAI"
        subtitle="This is the important part. You'll sign in on Facebook's own secure screen — EchoAI never sees your password."
      />

      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-4 text-left">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          What happens next
        </p>
        <NumberedSteps
          items={[
            "Facebook's official login and permission screen opens.",
            "You choose which Business Manager to connect.",
            "You choose which Ad Account and Facebook Page to use.",
            "You click Approve — and you're brought right back here.",
          ]}
        />
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-950/40 p-3 text-left text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg py-3.5 text-base font-bold text-white disabled:opacity-60"
        style={{ backgroundColor: FB }}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0022 12z" />
        </svg>
        {connecting ? "Opening Facebook…" : "Connect Facebook"}
      </button>
    </div>
  );
}

function CheckRow({ check }) {
  const pass = check.status === "pass";
  return (
    <li className="flex gap-3 rounded-lg border border-gray-800 bg-gray-900 p-3">
      <span
        className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-white ${
          pass ? "bg-emerald-500" : "bg-amber-500"
        }`}
      >
        {pass ? (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="text-xs font-bold">!</span>
        )}
      </span>
      <div>
        <p className="text-sm font-medium text-gray-200">{check.label}</p>
        <p className="mt-0.5 text-xs text-gray-400">{check.detail}</p>
      </div>
    </li>
  );
}

function VerifyStep({ goNext }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null); // { accounts, selectedAccountId, pages, selectedPageId }
  const [checks, setChecks] = useState([]);
  const [busy, setBusy] = useState(false);

  const runVerify = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.verifyFacebookConnection();
      setChecks(res.checks || []);
    } catch (e) {
      setError(e.message || "Couldn't verify the connection.");
    } finally {
      setBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const accts = await api.getFacebookAccounts();
      if (!accts.connected) {
        setError("Facebook isn't connected yet. Go back a step and connect first.");
        setLoading(false);
        return;
      }
      setData(accts);
      await runVerify();
    } catch (e) {
      setError(e.message || "Couldn't load your Facebook connection.");
    } finally {
      setLoading(false);
    }
  }, [runVerify]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSelectAccount(id) {
    setData((d) => ({ ...d, selectedAccountId: id }));
    try {
      await api.selectFacebookAccount(id);
      await runVerify();
    } catch (e) {
      setError(e.message);
    }
  }

  async function onSelectPage(id) {
    setData((d) => ({ ...d, selectedPageId: id }));
    try {
      await api.selectFacebookPage(id);
      await runVerify();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">
        Checking your Facebook connection…
      </div>
    );
  }

  const allPass = checks.length > 0 && checks.every((c) => c.status === "pass");

  return (
    <div>
      <StepHeading
        title="Verify your connection"
        subtitle="I ran a quick check to make sure everything's ready for Atlas to run ads."
      />

      {error && (
        <div className="mt-3 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
      )}

      {data && (
        <div className="mt-4 space-y-3">
          {data.accounts?.length > 1 && (
            <label className="block">
              <span className="text-xs font-medium text-gray-400">Ad account</span>
              <select
                value={data.selectedAccountId || ""}
                onChange={(e) => onSelectAccount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-200"
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data.pages?.length > 1 && (
            <label className="block">
              <span className="text-xs font-medium text-gray-400">Facebook Page</span>
              <select
                value={data.selectedPageId || ""}
                onChange={(e) => onSelectPage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-200"
              >
                {data.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={runVerify}
          disabled={busy}
          className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-60"
        >
          {busy ? "Testing…" : "Re-run test"}
        </button>
        <button
          onClick={goNext}
          className="flex-1 rounded-lg py-3 text-sm font-bold text-white"
          style={{ backgroundColor: FB }}
        >
          {allPass ? "Continue" : "Continue anyway"}
        </button>
      </div>
    </div>
  );
}

function LaunchStep({ brandId, enqueue, finish }) {
  const [loading, setLoading] = useState(true);
  const [creative, setCreative] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [monthly, setMonthly] = useState(300);
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!brandId) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.getAdCreatives(brandId);
        if (!active) return;
        const list = res.creatives || [];
        const usable = list.find(
          (c) =>
            c.status !== "launched" &&
            c.creative_concept &&
            Array.isArray(c.creative_concept.packages) &&
            c.creative_concept.packages.length > 0,
        );
        if (usable) {
          setCreative(usable);
          setPkg(usable.creative_concept.packages[0]);
        }
      } catch (e) {
        if (active) setError(e.message || "Couldn't load your ad creatives.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

  const dailyBudget = Math.max(1, Math.round(Number(monthly) / 30));

  async function handleLaunch() {
    setLaunching(true);
    setError("");
    try {
      await api.launchAdCreative({
        creativeId: creative.creative_id,
        packageIndex: 0,
        budget: dailyBudget,
      });
      setLaunched(true);
      if (enqueue) {
        enqueue({
          type: "status",
          title: "Facebook Setup",
          text: "Your first campaign is live. I'll keep an eye on it and let you know how it performs.",
        });
      }
    } catch (e) {
      setError(e.message || "Couldn't launch the campaign.");
    } finally {
      setLaunching(false);
    }
  }

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">Loading your ad creative…</div>
    );
  }

  if (launched) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500">
          <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-bold text-gray-100">Your first campaign is live</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-400">
          It's launched paused so nothing spends until you give the go-ahead in
          Atlas. You're all set!
        </p>
        <button
          onClick={finish}
          className="mt-6 w-full rounded-lg py-3 text-sm font-bold text-white"
          style={{ backgroundColor: FB }}
        >
          Done
        </button>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div>
        <StepHeading
          title="You're connected!"
          subtitle="Atlas is ready to run ads for you."
        />
        <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
          Forge hasn't generated any ad creatives for this brand yet. Head to the
          Ad Creative Studio to create your first set, then you can launch it in
          one click.
        </div>
        {error && (
          <div className="mt-3 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
        )}
        <button
          onClick={finish}
          className="mt-6 w-full rounded-lg py-3 text-sm font-bold text-white"
          style={{ backgroundColor: FB }}
        >
          Finish
        </button>
      </div>
    );
  }

  const body =
    (Array.isArray(pkg.bodyCopyVariations) && pkg.bodyCopyVariations[0]) ||
    pkg.bodyCopy ||
    "";
  const t = pkg.audienceTargeting || {};
  const audienceBits = [
    Array.isArray(t.countries) && t.countries.length ? t.countries.join(", ") : "United States",
    t.ageMin || t.ageMax ? `ages ${t.ageMin || 18}–${t.ageMax || 65}` : null,
  ].filter(Boolean);

  return (
    <div>
      <StepHeading
        title="Launch your first campaign"
        subtitle="Here's the first ad Forge created for you. Confirm your budget and go live whenever you're ready."
      />

      {/* Ad preview */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Ad preview
        </div>
        <div className="p-4">
          <p className="text-base font-bold text-gray-100">{pkg.headline}</p>
          {body && <p className="mt-2 text-sm leading-relaxed text-gray-300">{body}</p>}
          <p className="mt-3 text-xs text-gray-500">
            <span className="font-semibold text-gray-400">Target audience:</span>{" "}
            {audienceBits.join(" · ")}
          </p>
        </div>
      </div>

      {/* Budget */}
      <label className="mt-4 block">
        <span className="text-sm font-medium text-gray-200">Monthly ad budget</span>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-gray-400">$</span>
          <input
            type="number"
            min="30"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            className="w-32 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-200"
          />
          <span className="text-xs text-gray-500">≈ ${dailyBudget}/day</span>
        </div>
      </label>

      {error && (
        <div className="mt-3 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
      )}

      <div className="mt-5 space-y-2">
        <button
          onClick={handleLaunch}
          disabled={launching}
          className="w-full rounded-lg py-3.5 text-base font-bold text-white disabled:opacity-60"
          style={{ backgroundColor: FB }}
        >
          {launching ? "Launching…" : "Launch My First Campaign"}
        </button>
        <button
          onClick={finish}
          className="w-full rounded-lg border border-gray-700 py-3 text-sm font-medium text-gray-300 hover:bg-gray-800"
        >
          I'll do this later
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-gray-500">
        Campaigns launch paused — nothing spends until you approve it in Atlas.
      </p>
    </div>
  );
}
