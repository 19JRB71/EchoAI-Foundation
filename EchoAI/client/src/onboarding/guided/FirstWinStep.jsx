// Milestone 1 — "Your First Win" (Customer Experience Constitution: Time to
// First Success). Before any account is connected, the customer accomplishes
// something real: publish a first post, build a first ad, generate a first
// email, or import a first lead. One decision at a time; every click creates
// value; honest failures (AI errors surface as-is, never mocked).

import { useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import { meetsTier } from "../../lib/tiers.js";

// Prompt 024: the consent copy version captured when arming an unbound
// destination ("the Facebook Page you connect during onboarding"). Must match
// the server's CONSENT_COPY_VERSIONS whitelist.
export const CONSENT_COPY_UNBOUND = "p024-v1-destination-unbound";

const WIN_CHOICES = [
  {
    key: "post",
    icon: "📣",
    title: "Publish my first social post",
    detail: "Tell Echo a topic — he'll write it and stage it, ready for your say-so.",
    minTier: null,
  },
  {
    key: "lead",
    icon: "🤝",
    title: "Import my first lead",
    detail: "Add a customer or prospect — Echo starts watching over them.",
    minTier: null,
  },
  {
    key: "ad",
    icon: "🎯",
    title: "Build my first Facebook ad",
    detail: "Echo designs complete ad packages for your business.",
    minTier: "pro",
  },
  {
    key: "email",
    icon: "✉️",
    title: "Write my first marketing email",
    detail: "Echo writes a full campaign email in your brand's voice.",
    minTier: "pro",
  },
];

export default function FirstWinStep({ flags, updateFlags, speak, onNext, onBack }) {
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState(null);
  const [tier, setTier] = useState("starter");
  const [loadError, setLoadError] = useState("");
  const saved = flags?.firstwin || {};
  const [choice, setChoice] = useState(saved.done ? saved.choice || null : null);
  const [done, setDone] = useState(Boolean(saved.done));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [brandsRes, subRes] = await Promise.allSettled([
          api.getBrands(),
          api.getSubscriptionStatus(),
        ]);
        if (!active) return;
        if (brandsRes.status === "fulfilled") {
          const list = brandsRes.value?.brands || brandsRes.value || [];
          setBrand(Array.isArray(list) && list.length > 0 ? list[0] : null);
        } else {
          setLoadError(
            brandsRes.reason?.message || "Couldn't load your business profile.",
          );
        }
        if (subRes.status === "fulfilled" && subRes.value?.subscriptionTier) {
          setTier(subRes.value.subscriptionTier);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function recordWin(winKey) {
    setDone(true);
    updateFlags("firstwin", { choice: winKey, done: true, skipped: false });
  }

  function skipStep() {
    updateFlags("firstwin", { skipped: true });
    onNext();
  }

  if (loading) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner label="One moment…" />
      </div>
    );
  }

  const available = WIN_CHOICES.filter(
    (c) => !c.minTier || meetsTier(tier, c.minTier),
  );

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
        Milestone 1 · Your first win
      </p>
      <h2 className="mt-1 text-2xl font-extrabold text-gray-100">
        Let&apos;s get something working immediately.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        Before we connect anything, let&apos;s have Echo do a piece of real work for your
        business — right now. Pick one:
      </p>

      {!brand && (
        <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
          <p className="text-sm leading-relaxed text-amber-100">
            {loadError
              ? `I couldn't check your business profile just now (${loadError}). You can go back and try again, or skip this for now.`
              : "I don't have your business profile yet, Sir — go back one step and tell me about your business first, and I'll put it to work here."}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600"
            >
              Back to my business profile
            </button>
            <button
              type="button"
              onClick={skipStep}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:bg-gray-800"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {brand && !choice && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {available.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setChoice(c.key);
                if (speak) speak(`Excellent choice, Sir. ${c.detail}`);
              }}
              className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-left transition hover:border-amber-500/50 hover:bg-gray-800"
            >
              <span className="text-2xl">{c.icon}</span>
              <p className="mt-2 font-bold text-gray-100">{c.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-400">{c.detail}</p>
            </button>
          ))}
        </div>
      )}

      {brand && choice === "post" && (
        <PostWin brand={brand} done={done} onDone={() => recordWin("post")} onChangeMind={() => !done && setChoice(null)} />
      )}
      {brand && choice === "lead" && (
        <LeadWin brand={brand} done={done} onDone={() => recordWin("lead")} onChangeMind={() => !done && setChoice(null)} />
      )}
      {brand && choice === "ad" && (
        <AdWin brand={brand} done={done} onDone={() => recordWin("ad")} onChangeMind={() => !done && setChoice(null)} />
      )}
      {brand && choice === "email" && (
        <EmailWin brand={brand} done={done} onDone={() => recordWin("email")} onChangeMind={() => !done && setChoice(null)} />
      )}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800"
        >
          Back
        </button>
        {done ? (
          <button
            type="button"
            onClick={onNext}
            className="rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600"
          >
            Next milestone →
          </button>
        ) : (
          <button
            type="button"
            onClick={skipStep}
            className="text-sm font-medium text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline"
          >
            Skip — I&apos;ll do this later
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WinShell({ title, children, error, onChangeMind, done }) {
  return (
    <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-gray-100">{title}</h3>
        {!done && (
          <button
            type="button"
            onClick={onChangeMind}
            className="shrink-0 text-xs font-semibold text-gray-500 hover:text-gray-300"
          >
            Pick a different win
          </button>
        )}
      </div>
      {error && (
        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
          <p className="text-sm leading-relaxed text-amber-100">{error}</p>
        </div>
      )}
      {children}
    </div>
  );
}

function Celebrate({ heading, body }) {
  return (
    <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
      <p className="text-sm font-bold text-emerald-200">🎉 {heading}</p>
      <p className="mt-1 text-sm leading-relaxed text-emerald-100/90">{body}</p>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none";
const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50";

// --- First social post ------------------------------------------------------

// Prompt 024: the honest first-post flow. The post is PREPARED (written and
// staged), never claimed to be "on the calendar". Publishing happens only
// after the owner ARMS it with explicit, artifact-bound consent AND connects
// Facebook — the connection callback fires the armed authorization.
function PostWin({ brand, done, onDone, onChangeMind }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [variations, setVariations] = useState(null);
  // prepared post + authorization state (loaded from the status projection
  // so a returning owner sees the truth, not stale local state).
  const [prepared, setPrepared] = useState(null); // {postId, postContent}
  const [auth, setAuth] = useState(null); // authorization from /status or /arm
  const [loadingState, setLoadingState] = useState(done);

  useEffect(() => {
    if (!done) return;
    let active = true;
    (async () => {
      try {
        const s = await api.getOnboardingStatus();
        if (!active) return;
        if (s.firstWin) {
          setPrepared({
            postId: s.firstWin.postId,
            postContent: s.firstWin.postContent,
            status: s.firstWin.status,
          });
        }
        setAuth(s.authorization || null);
      } catch {
        /* the step still renders; actions surface their own errors */
      } finally {
        if (active) setLoadingState(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [done]);

  async function generate() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.generateSocial(brand.brand_id, topic.trim(), "facebook");
      setVariations(res.variations || []);
    } catch (err) {
      setError(err.message || "Echo couldn't write the post just now — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function prepare(postContent) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.prepareFirstWinPost({
        brandId: brand.brand_id,
        postContent,
      });
      setPrepared({
        postId: res.post.postId,
        postContent: res.post.postContent,
        status: res.post.status,
      });
      setAuth(null);
    } catch (err) {
      setError(err.message || "Couldn't save the post — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function arm() {
    if (busy || !prepared) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.armFirstWinPost({
        postId: prepared.postId,
        consentCopyVersion: CONSENT_COPY_UNBOUND,
      });
      setAuth(res.authorization);
      onDone();
    } catch (err) {
      setError(err.message || "Couldn't record your authorization — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disarm() {
    if (busy || !auth) return;
    setBusy(true);
    setError("");
    try {
      await api.disarmFirstWinPost(auth.authorizationId);
      setAuth(null);
    } catch (err) {
      // Honest failure: a claimed authorization can no longer be cancelled.
      setError(err.message || "Couldn't cancel — it may already be publishing.");
    } finally {
      setBusy(false);
    }
  }

  if (loadingState) {
    return (
      <WinShell title="Your first social post" onChangeMind={onChangeMind} done={done}>
        <div className="mt-4 flex justify-center">
          <Spinner label="Checking your post…" />
        </div>
      </WinShell>
    );
  }

  const authActive = auth && auth.status === "armed" && !auth.expired && !auth.reconfirmationRequired;
  const authNeedsReconfirm = auth && (auth.expired || auth.reconfirmationRequired);

  return (
    <WinShell title="Your first social post" error={error} onChangeMind={onChangeMind} done={done}>
      {prepared && prepared.status === "failed" ? (
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
          <p className="text-sm font-bold text-amber-200">
            The publish attempt didn&apos;t go through.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-100/90">
            Nothing was celebrated because nothing was verified as published.
            You&apos;ll find the post and what went wrong in your dashboard&apos;s
            content calendar, where you can fix and reschedule it.
          </p>
        </div>
      ) : prepared && prepared.status === "published" ? (
        <Celebrate
          heading="Your first post is live."
          body="You authorized it, Facebook was connected, and the post published. The confirmation is on your dashboard."
        />
      ) : prepared && prepared.status && prepared.status !== "prepared" ? (
        <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/10 p-4">
          <p className="text-sm font-bold text-sky-200">
            Your first post has been handed to the publishing system.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-sky-100/90">
            You authorized it and Facebook is connected — it&apos;s in the publish
            queue now. I&apos;ll only call it a win once Facebook confirms it
            actually went live; you&apos;ll see that on your dashboard.
          </p>
        </div>
      ) : prepared && authActive ? (
        <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <p className="text-sm font-bold text-emerald-200">
            ✅ Ready to publish the moment you connect Facebook.
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-emerald-100/90">
            {prepared.postContent}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-emerald-100/80">
            Your authorization covers exactly this post, published once to the
            Facebook Page you connect during onboarding. It lasts 7 days
            {auth.expiresAt ? ` (until ${new Date(auth.expiresAt).toLocaleDateString()})` : ""} —
            after that I&apos;ll ask you to confirm again. Saving your setup for
            later does NOT cancel it; the Cancel button below does.
          </p>
          <button
            type="button"
            onClick={disarm}
            disabled={busy}
            className="mt-3 rounded-lg border border-emerald-400/40 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? "Cancelling…" : "Cancel this authorization"}
          </button>
        </div>
      ) : prepared ? (
        <div className="mt-4">
          <div className="rounded-xl border border-gray-800 bg-gray-950 p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
              {prepared.postContent}
            </p>
          </div>
          {authNeedsReconfirm && (
            <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
              <p className="text-sm leading-relaxed text-amber-100">
                {auth.expired || auth.invalidationReason === "expired"
                  ? "Your earlier authorization expired (they last 7 days), so nothing was published."
                  : auth.invalidationReason === "content_changed"
                    ? "The post changed after you authorized it, so the earlier authorization no longer applies and nothing was published."
                    : auth.invalidationReason === "page_switched"
                      ? "The Facebook Page changed after you authorized it, so the earlier authorization no longer applies and nothing was published."
                      : auth.status === "execution_failed"
                        ? "The publish attempt failed before anything reached Facebook — nothing was posted."
                        : "Your earlier authorization is no longer active and nothing was published."}
                {" "}If you still want this post published, please confirm again below.
              </p>
            </div>
          )}
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-gray-950 p-4">
            <p className="text-sm font-semibold text-gray-100">
              Publish this automatically when I connect Facebook?
            </p>
            <p className="mt-2 text-xs leading-relaxed text-gray-400">
              If you authorize it, this exact post — shown above, and nothing
              else — will be published ONCE to the Facebook Page you connect
              during onboarding, immediately after you connect it. The
              authorization lasts 7 days; if you haven&apos;t connected by then,
              nothing publishes and I&apos;ll ask you again. Saving your setup for
              later does NOT cancel it. You can cancel any time before you
              connect with the Cancel button that appears here.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={arm} disabled={busy} className={primaryBtn}>
                {busy ? "Recording…" : "Yes — publish it when I connect Facebook"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Not ready? That&apos;s fine — your post stays saved either way, and
              nothing is ever published without this authorization.
            </p>
          </div>
        </div>
      ) : !variations ? (
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-300">
            What should the post be about?
          </label>
          <input
            className={`${inputCls} mt-2`}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. our summer special, a customer success story…"
            maxLength={200}
          />
          <button type="button" onClick={generate} disabled={busy || !topic.trim()} className={`${primaryBtn} mt-3`}>
            {busy ? "Echo is writing…" : "Write my post"}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-400">
            Echo wrote {variations.length} versions — pick your favorite and I&apos;ll
            save it, ready for your say-so:
          </p>
          {variations.map((v, i) => (
            <div key={i} className="rounded-xl border border-gray-800 bg-gray-950 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                {typeof v === "string" ? v : v.content || v.text || ""}
              </p>
              <button
                type="button"
                onClick={() => prepare(typeof v === "string" ? v : v.content || v.text || "")}
                disabled={busy}
                className={`${primaryBtn} mt-2`}
              >
                {busy ? "Saving…" : "Use this one"}
              </button>
            </div>
          ))}
        </div>
      )}
    </WinShell>
  );
}

// --- First lead --------------------------------------------------------------

function LeadWin({ brand, done, onDone, onChangeMind }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedLead, setSavedLead] = useState(done);

  async function save() {
    if (busy) return;
    if (!name.trim() && !email.trim() && !phone.trim()) {
      setError("Give me at least a name, an email, or a phone number, Sir.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.createLead({
        brandId: brand.brand_id,
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setSavedLead(true);
      onDone();
    } catch (err) {
      setError(err.message || "Couldn't save the lead — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WinShell title="Your first lead" error={error} onChangeMind={onChangeMind} done={done}>
      {savedLead ? (
        <Celebrate
          heading="Your first lead is in your CRM."
          body="Echo is watching over them now — follow-ups, temperature, and conversion tracking are live."
        />
      ) : (
        <div className="mt-4 space-y-3">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={120} />
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" maxLength={200} />
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel" maxLength={40} />
          <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : "Add my first lead"}
          </button>
        </div>
      )}
    </WinShell>
  );
}

// --- First Facebook ad --------------------------------------------------------

const AD_GOALS = [
  { value: "lead_generation", label: "Bring me more leads" },
  { value: "sales", label: "Drive more sales" },
  { value: "brand_awareness", label: "Get my name out there" },
];

function AdWin({ brand, done, onDone, onChangeMind }) {
  const [goal, setGoal] = useState("lead_generation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAd, setSavedAd] = useState(done);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.generateAdCreatives({
        brandId: brand.brand_id,
        campaignGoal: goal,
      });
      const packages = res.packages || [];
      if (packages.length === 0) throw new Error("Echo didn't return any ad packages.");
      await api.saveAdCreative({
        brandId: brand.brand_id,
        campaignGoal: goal,
        packages,
      });
      setSavedAd(true);
      onDone();
    } catch (err) {
      setError(err.message || "Echo couldn't build the ads just now — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WinShell title="Your first Facebook ad" error={error} onChangeMind={onChangeMind} done={done}>
      {savedAd ? (
        <Celebrate
          heading="Your first ad creatives are ready."
          body="Echo built complete ad packages and saved them as drafts in your Ad Studio. Connect Facebook in the next milestone and you can launch one."
        />
      ) : (
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-300">What&apos;s the goal?</label>
          <div className="mt-2 space-y-2">
            {AD_GOALS.map((g) => (
              <label key={g.value} className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
                <input
                  type="radio"
                  name="adgoal"
                  checked={goal === g.value}
                  onChange={() => setGoal(g.value)}
                  className="accent-amber-500"
                />
                {g.label}
              </label>
            ))}
          </div>
          <button type="button" onClick={generate} disabled={busy} className={`${primaryBtn} mt-4`}>
            {busy ? "Echo is designing your ads… (about a minute)" : "Build my ads"}
          </button>
        </div>
      )}
    </WinShell>
  );
}

// --- First marketing email -----------------------------------------------------

function EmailWin({ brand, done, onDone, onChangeMind }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emailOut, setEmailOut] = useState(null);
  const [finished, setFinished] = useState(done);

  async function generate() {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.generateCampaignEmail({
        brandId: brand.brand_id,
        goal: goal.trim(),
      });
      const email = res.email;
      if (!email) throw new Error("Echo didn't return an email.");
      setEmailOut(email);
      setFinished(true);
      onDone();
    } catch (err) {
      setError(err.message || "Echo couldn't write the email just now — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WinShell title="Your first marketing email" error={error} onChangeMind={onChangeMind} done={done}>
      {finished ? (
        <div>
          <Celebrate
            heading="Your first campaign email is written."
            body="You'll find it — and everything else Echo can send — in the Email Marketing department."
          />
          {emailOut && (
            <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950 p-4">
              <p className="text-sm font-semibold text-gray-100">
                {(emailOut.subjectVariations || [])[0] || "Your email"}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                {emailOut.bodyPlainText || ""}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-300">
            What should this email accomplish?
          </label>
          <input
            className={`${inputCls} mt-2`}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. announce our new service, win back past customers…"
            maxLength={200}
          />
          <button type="button" onClick={generate} disabled={busy || !goal.trim()} className={`${primaryBtn} mt-3`}>
            {busy ? "Echo is writing…" : "Write my email"}
          </button>
        </div>
      )}
    </WinShell>
  );
}
