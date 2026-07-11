import { useEffect } from "react";
import { Link } from "react-router-dom";
import DemoForm from "./DemoForm.jsx";
import { api } from "../api.js";
import { setReferralCode } from "../lib/referral.js";
import { AGENTS_META } from "../lib/departments.js";

// One-line pitch for each AI team member, keyed by the agent id in AGENTS_META.
// (AGENTS_META is the single source of truth for id / name / title / color.)
const AGENT_PITCH = {
  echo: "Your marketing director — briefs you every morning and runs the whole team.",
  scout: "Watches competitors and hunts down market openings, keywords and grants.",
  atlas: "Launches and optimizes your ad campaigns to get more leads for less.",
  nova: "Plans and publishes your content across every social platform.",
  pulse: "Qualifies leads and follows up by email, text and phone — automatically.",
  voice: "Answers your phone and website chat, booking qualified leads day and night.",
  forge: "Creates on-brand images, videos and ad creative on demand.",
  sentinel: "Watches your systems and fixes issues before you ever notice.",
};

function scrollToDemo(e) {
  e.preventDefault();
  const el = document.getElementById("demo");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

export default function LandingPage() {
  // Capture an affiliate referral code from the URL (?ref=CODE), persist it so
  // it survives the navigation to signup, and store it as a cookie server-side.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) {
      setReferralCode(ref);
      api.trackReferral(ref).catch(() => {});
    }
  }, []);

  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <Nav />
      <Hero />
      <TeamGrid />
      <MissionControlPreview />
      <Solution />
      <SocialProof />
      <Pricing />
      <DemoSection />
      <Footer />
    </div>
  );
}

function Logo({ className = "" }) {
  return (
    <img
      src="/zorecho-wordmark.png"
      alt="Zorecho"
      className={`h-6 w-auto sm:h-7 ${className}`}
    />
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo className="text-xl" />
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
          >
            Log in
          </Link>
          <a
            href="#demo"
            onClick={scrollToDemo}
            className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110"
          >
            Book Demo
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-teal-500/20 blur-3xl" />
      <div className="pointer-events-none absolute top-24 right-0 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute top-40 left-0 h-72 w-72 rounded-full bg-purple-600/20 blur-3xl" />
      <div className="relative mx-auto max-w-4xl px-6 pt-24 pb-12 text-center sm:pt-32">
        <span className="inline-block rounded-full border border-teal-400/30 bg-teal-400/10 px-4 py-1.5 text-sm font-medium text-teal-300">
          Your AI marketing department — always on
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
          Meet Your{" "}
          <span className="bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
            AI Marketing Department.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 sm:text-xl">
          Nine specialists working around the clock so you never have to think
          about marketing again.
        </p>
        <div className="mt-10">
          <a
            href="#demo"
            onClick={scrollToDemo}
            className="inline-block rounded-xl bg-gradient-to-r from-teal-400 to-cyan-500 px-8 py-4 text-lg font-bold text-black shadow-lg shadow-teal-500/25 transition hover:brightness-110"
          >
            Book Your Free Demo
          </a>
          <p className="mt-4 text-sm text-slate-400">
            Free onboarding call. We'll call you within 24 hours.
          </p>
        </div>
      </div>
    </section>
  );
}

function AgentAvatar({ name, color }) {
  return (
    <div
      className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-black text-black shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}bb)`,
        boxShadow: `0 12px 26px -12px ${color}`,
      }}
      aria-hidden="true"
    >
      {name[0]}
    </div>
  );
}

function TeamGrid() {
  return (
    <section className="border-t border-white/5 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-teal-400">
            Your team
          </span>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            Nine AI specialists. One relentless team.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Each one owns a part of your marketing and works 24/7 — no hiring, no
            managing, no burnout.
          </p>
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS_META.map((agent) => (
            <div
              key={agent.id}
              className="group flex flex-col rounded-2xl border border-white/10 bg-slate-900/50 p-6 transition hover:-translate-y-1 hover:border-white/20"
              style={{ boxShadow: `inset 0 1px 0 0 ${agent.color}22` }}
            >
              <AgentAvatar name={agent.name} color={agent.color} />
              <h3 className="mt-4 text-lg font-bold text-white">{agent.name}</h3>
              <p
                className="text-sm font-semibold"
                style={{ color: agent.color }}
              >
                {agent.title}
              </p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">
                {AGENT_PITCH[agent.id]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MissionControlPreview() {
  const teamStatus = AGENTS_META.map((a) => ({
    ...a,
    state: a.id === "sentinel" ? "Auto-fixing" : a.id === "atlas" ? "Optimizing" : "Active",
  }));
  const comingUp = [
    { icon: "📞", label: "Reminder: consult with Dana R.", when: "in 15 min" },
    { icon: "📣", label: "Nova publishes 3 scheduled posts", when: "in 42 min" },
    { icon: "📊", label: "Echo delivers your weekly report", when: "Monday 8:00 AM" },
    { icon: "🕵️", label: "Scout's competitor scan refreshes", when: "in 3 hrs" },
  ];
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-24">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-[44rem] -translate-x-1/2 rounded-full bg-teal-600/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-teal-400">
            A window into your dashboard
          </span>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            This is Mission Control.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Log in and your whole operation is already running. Here's what you'd
            see this morning.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-5xl rounded-3xl border border-white/10 bg-slate-900/60 p-4 shadow-2xl sm:p-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <Logo className="text-lg" />
            <span className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              All systems live
            </span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {/* Morning briefing */}
            <div className="rounded-2xl border border-teal-400/20 bg-gradient-to-b from-teal-500/10 to-transparent p-5 lg:col-span-2">
              <div className="flex items-center gap-3">
                <AgentAvatar name="Echo" color="#14B8A6" />
                <div>
                  <p className="text-sm font-bold text-white">Morning Briefing</p>
                  <p className="flex items-center gap-1.5 text-xs text-teal-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
                    Echo is speaking…
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">
                "Good morning! You booked{" "}
                <span className="font-semibold text-white">7 new leads</span>{" "}
                overnight — 2 are hot and already texted. Atlas shifted{" "}
                <span className="font-semibold text-white">$40</span> into your
                best-performing ad, and your cost per lead is down{" "}
                <span className="font-semibold text-emerald-300">18%</span> this
                week. Nothing needs your attention. Have a great day."
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2">
                  <p className="text-lg font-black text-white">7</p>
                  <p className="text-[11px] text-slate-400">New leads</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2">
                  <p className="text-lg font-black text-white">3</p>
                  <p className="text-[11px] text-slate-400">Active campaigns</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2">
                  <p className="text-lg font-black text-emerald-300">$212</p>
                  <p className="text-[11px] text-slate-400">Cost / lead ↓</p>
                </div>
              </div>
            </div>

            {/* Coming up */}
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <p className="text-sm font-bold text-white">Coming up</p>
              <ul className="mt-4 space-y-3">
                {comingUp.map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <span className="text-base">{item.icon}</span>
                    <div>
                      <p className="text-sm leading-snug text-slate-200">
                        {item.label}
                      </p>
                      <p className="text-xs text-slate-500">{item.when}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Team status */}
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5">
            <p className="text-sm font-bold text-white">Team status</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {teamStatus.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2.5"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {a.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {a.state}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Solution() {
  const items = [
    {
      icon: "⚙️",
      title: "Campaigns that run and optimize themselves",
      body: "Atlas launches your ads and automatically shifts budget toward what's converting — every day, without you lifting a finger.",
    },
    {
      icon: "🤖",
      title: "Leads answered and followed up in seconds",
      body: "Voice qualifies every lead day or night, and Pulse follows up by email, text and phone — so nothing slips away.",
    },
    {
      icon: "📡",
      title: "Competitor intelligence, refreshed all day",
      body: "Scout scans your market every few hours so you always know what's working — and Echo turns it into a plan.",
    },
  ];
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-24">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-96 w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-teal-400">
            How it works
          </span>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            Your team does the marketing work for you.
          </h2>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/30 p-7"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-400/15 text-2xl">
                {it.icon}
              </div>
              <h3 className="mt-5 text-lg font-bold text-white">{it.title}</h3>
              <p className="mt-3 text-slate-400">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SocialProof() {
  const testimonials = [
    {
      quote:
        "We cut our cost per lead almost in half and I haven't touched our ad account in months. It just works.",
      name: "Sarah Mitchell",
      business: "Bright Smile Dental",
    },
    {
      quote:
        "The AI chatbot books consultations while I sleep. I show up to a calendar full of qualified leads.",
      name: "Marcus Lee",
      business: "Apex Fitness Studio",
    },
    {
      quote:
        "Finally I can see what my competitors are running. Zorecho paid for itself in the first two weeks.",
      name: "Dana Rivera",
      business: "Rivera Law Group",
    },
  ];
  const stats = [
    { value: "200+", label: "Leads generated" },
    { value: "40%", label: "Lower cost per lead" },
    { value: "10 hrs", label: "Saved every week" },
  ];
  return (
    <section className="border-t border-white/5 bg-black py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">
          Built to deliver real results.
        </h2>
        <div className="mt-12 grid gap-6 rounded-2xl border border-white/10 bg-slate-900/40 p-8 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-4xl font-black text-teal-400 sm:text-5xl">
                {s.value}
              </div>
              <div className="mt-2 text-sm text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure
              key={t.name}
              className="flex flex-col rounded-2xl border border-white/10 bg-slate-900/50 p-7"
            >
              <div className="text-teal-400">★★★★★</div>
              <blockquote className="mt-4 flex-1 text-slate-200">
                "{t.quote}"
              </blockquote>
              <figcaption className="mt-5 border-t border-white/10 pt-4">
                <div className="font-semibold text-white">{t.name}</div>
                <div className="text-sm text-slate-400">{t.business}</div>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Placeholder testimonials — to be replaced with real customer stories.
        </p>
      </div>
    </section>
  );
}

function Pricing() {
  const tiers = [
    {
      name: "Starter",
      price: "$197",
      unit: "/month",
      tagline: "For solo operators",
      accent: "#3B82F6",
      features: [
        "Automated ad campaigns",
        "AI lead qualification chatbot",
        "Embeddable website widget",
        "Weekly performance reports",
        "1 user included",
      ],
      featured: false,
    },
    {
      name: "Professional",
      price: "$497",
      unit: "/month",
      tagline: "For growing teams",
      accent: "#8B5CF6",
      features: [
        "Everything in Starter",
        "AI phone agent & voice chatbot",
        "Reputation & content calendar",
        "Ad creative studio & Zapier",
        "1 user included",
      ],
      featured: true,
    },
    {
      name: "Enterprise",
      price: "$997",
      unit: "/month",
      tagline: "For agencies & at scale",
      accent: "#F59E0B",
      features: [
        "Everything in Professional",
        "White-label agency system",
        "Affiliate program & mobile API",
        "Customer feedback & surveys",
        "1 user included",
      ],
      featured: false,
    },
  ];
  const comparison = [
    { feature: "Facebook ad automation", starter: true, pro: true, enterprise: true },
    { feature: "Basic CRM & lead scoring", starter: true, pro: true, enterprise: true },
    { feature: "AI lead-qualification chatbot", starter: true, pro: true, enterprise: true },
    { feature: "Website chatbot widget", starter: true, pro: true, enterprise: true },
    { feature: "Weekly performance reports", starter: true, pro: true, enterprise: true },
    { feature: "Email notifications", starter: true, pro: true, enterprise: true },
    { feature: "Social posting", starter: "2 platforms", pro: "All 6", enterprise: "All 6" },
    { feature: "Voice chatbot", starter: false, pro: true, enterprise: true },
    { feature: "AI phone agent", starter: false, pro: true, enterprise: true },
    { feature: "Reputation management", starter: false, pro: true, enterprise: true },
    { feature: "Sales script generator", starter: false, pro: true, enterprise: true },
    { feature: "Content calendar", starter: false, pro: true, enterprise: true },
    { feature: "Video script generator", starter: false, pro: true, enterprise: true },
    { feature: "AI ad creative studio", starter: false, pro: true, enterprise: true },
    { feature: "Zapier integration", starter: false, pro: true, enterprise: true },
    { feature: "White-label agency", starter: false, pro: false, enterprise: true },
    { feature: "Affiliate program", starter: false, pro: false, enterprise: true },
    { feature: "Mobile app API", starter: false, pro: false, enterprise: true },
    { feature: "Customer feedback & surveys", starter: false, pro: false, enterprise: true },
    { feature: "Advanced analytics", starter: false, pro: false, enterprise: true },
    { feature: "API marketplace access", starter: false, pro: false, enterprise: true },
    { feature: "Priority support", starter: false, pro: false, enterprise: true },
    { feature: "Included users", starter: "1", pro: "1", enterprise: "1" },
    { feature: "Additional seats", starter: "$50/seat", pro: "$50/seat", enterprise: "$50/seat" },
  ];
  const cell = (v, color) => {
    if (v === true) return <span style={{ color }}>✓</span>;
    if (v === false) return <span className="text-slate-600">—</span>;
    return <span className="text-slate-200">{v}</span>;
  };
  return (
    <section className="border-t border-white/5 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Simple pricing that pays for itself.
          </h2>
          <p className="mt-3 text-slate-400">
            Every plan includes a free onboarding call with me, personally.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Every plan includes 1 user. Add more team members for $50 / seat /
            month on any tier.
          </p>
        </div>
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {tiers.map((t) => {
            const onAccent = t.name === "Enterprise" ? "#1c1500" : "#ffffff";
            return (
              <div
                key={t.name}
                style={{
                  borderColor: t.featured ? `${t.accent}80` : `${t.accent}40`,
                  background: `linear-gradient(to bottom, ${t.accent}1f, rgba(15,23,42,0.4))`,
                  boxShadow: t.featured ? `0 22px 45px -18px ${t.accent}80` : undefined,
                }}
                className="relative flex flex-col rounded-2xl border p-8"
              >
                {t.featured && (
                  <span
                    style={{ backgroundColor: t.accent, color: onAccent }}
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-bold"
                  >
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-bold" style={{ color: t.accent }}>
                  {t.name}
                </h3>
                <p className="mt-1 text-sm text-slate-400">{t.tagline}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-black text-white">{t.price}</span>
                  <span className="text-slate-400">{t.unit}</span>
                </div>
                <ul className="mt-6 flex-1 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-slate-300">
                      <span className="mt-0.5" style={{ color: t.accent }}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="#demo"
                  onClick={scrollToDemo}
                  style={
                    t.featured
                      ? { backgroundColor: t.accent, color: onAccent }
                      : { borderColor: `${t.accent}80`, color: t.accent }
                  }
                  className={`mt-8 block rounded-xl px-6 py-3 text-center font-bold transition hover:brightness-110 ${
                    t.featured ? "" : "border"
                  }`}
                >
                  Book Your Free Demo
                </a>
              </div>
            );
          })}
        </div>

        <div className="mt-20">
          <h3 className="text-center text-2xl font-bold text-white">
            Compare every feature
          </h3>
          <p className="mt-2 text-center text-sm text-slate-500">
            See exactly what's included in each plan.
          </p>
          <div className="mt-8 overflow-x-auto">
            <table className="mx-auto w-full max-w-4xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-3 pr-4 text-left font-semibold text-slate-300">
                    Feature
                  </th>
                  <th
                    className="px-4 py-3 text-center font-semibold"
                    style={{ color: "#3B82F6" }}
                  >
                    Starter
                  </th>
                  <th
                    className="px-4 py-3 text-center font-semibold"
                    style={{ color: "#8B5CF6" }}
                  >
                    Professional
                  </th>
                  <th
                    className="px-4 py-3 text-center font-semibold"
                    style={{ color: "#F59E0B" }}
                  >
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature} className="border-b border-white/5">
                    <td className="py-3 pr-4 text-left text-slate-300">
                      {row.feature}
                    </td>
                    <td className="px-4 py-3 text-center">{cell(row.starter, "#3B82F6")}</td>
                    <td className="px-4 py-3 text-center">{cell(row.pro, "#8B5CF6")}</td>
                    <td className="px-4 py-3 text-center">
                      {cell(row.enterprise, "#F59E0B")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section
      id="demo"
      className="relative overflow-hidden border-t border-white/5 py-24"
    >
      <div className="pointer-events-none absolute -bottom-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-teal-500/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-3xl font-bold sm:text-4xl">
            Book your free demo.
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Tell us a little about your business. We'll show you exactly how your
            AI team gets you more leads for less — and we'll call you within 24
            hours to set up your free onboarding.
          </p>
          <ul className="mt-8 space-y-3 text-slate-300">
            <li className="flex items-center gap-3">
              <span className="text-teal-400">✓</span> A real call, not a sales bot
            </li>
            <li className="flex items-center gap-3">
              <span className="text-teal-400">✓</span> Free personal onboarding
            </li>
            <li className="flex items-center gap-3">
              <span className="text-teal-400">✓</span> No commitment required
            </li>
          </ul>
        </div>
        <DemoForm />
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-black py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-slate-500 sm:flex-row">
        <Logo className="text-white" />
        <span>© {new Date().getFullYear()} Zorecho. Your AI marketing department, always on.</span>
      </div>
    </footer>
  );
}
