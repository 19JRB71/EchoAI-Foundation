import { Link } from "react-router-dom";
import DemoForm from "./DemoForm.jsx";

function scrollToDemo(e) {
  e.preventDefault();
  const el = document.getElementById("demo");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white antialiased">
      <Nav />
      <Hero />
      <Problem />
      <Solution />
      <SocialProof />
      <Pricing />
      <DemoSection />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-extrabold tracking-tight">
          Echo<span className="text-cyan-400">AI</span>
        </span>
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
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:brightness-110"
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
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute top-20 right-0 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="relative mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
        <span className="inline-block rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-sm font-medium text-cyan-300">
          AI-powered marketing on autopilot
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
          Stop lighting money on fire with{" "}
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
            Facebook ads that don't work.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 sm:text-xl">
          EchoAI runs, optimizes, and follows up on your ad campaigns for you —
          so you get more leads for less money without touching a dashboard.
        </p>
        <div className="mt-10">
          <a
            href="#demo"
            onClick={scrollToDemo}
            className="inline-block rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-8 py-4 text-lg font-bold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:brightness-110"
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

function Problem() {
  const pains = [
    {
      icon: "🔥",
      title: "You're burning cash on ads that don't convert",
      body: "You boost a post, money disappears, and you've got nothing to show for it. You can't tell what's working — so you keep paying for what isn't.",
    },
    {
      icon: "⏰",
      title: "You have zero time to run campaigns or chase leads",
      body: "You're already doing three jobs. Tweaking ad sets and following up with every lead at 11pm isn't happening — so leads go cold and slip away.",
    },
    {
      icon: "🕵️",
      title: "You have no idea what your competitors are doing",
      body: "They're clearly running ads that work. You're guessing in the dark while they take the customers that should be yours.",
    },
  ];
  return (
    <section className="border-t border-white/5 bg-slate-950 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">
          If you run a small business, this probably sounds familiar.
        </h2>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {pains.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-white/10 bg-slate-900/50 p-7"
            >
              <div className="text-3xl">{p.icon}</div>
              <h3 className="mt-4 text-lg font-bold text-white">{p.title}</h3>
              <p className="mt-3 text-slate-400">{p.body}</p>
            </div>
          ))}
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
      body: "EchoAI launches your ads and automatically shifts budget toward what's converting — every day, without you lifting a finger.",
    },
    {
      icon: "🤖",
      title: "An AI voice chatbot that qualifies leads instantly",
      body: "Every lead gets answered and qualified in seconds, day or night. The hot ones land straight in your inbox, ready for you to close.",
    },
    {
      icon: "📡",
      title: "Competitor intelligence built in",
      body: "See exactly what ads are working in your market, so you can do more of what wins and stop guessing.",
    },
  ];
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-24">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-96 w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-cyan-400">
            The fix
          </span>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            EchoAI does the marketing work for you.
          </h2>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/30 p-7"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400/15 text-2xl">
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
        "Finally I can see what my competitors are running. EchoAI paid for itself in the first two weeks.",
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
    <section className="border-t border-white/5 bg-slate-950 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">
          Built to deliver real results.
        </h2>
        <div className="mt-12 grid gap-6 rounded-2xl border border-white/10 bg-slate-900/40 p-8 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-4xl font-black text-cyan-400 sm:text-5xl">
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
              <div className="text-cyan-400">★★★★★</div>
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
      price: "$50",
      unit: "/month",
      tagline: "For solo operators",
      features: [
        "Automated ad campaigns",
        "AI lead qualification chatbot",
        "Weekly performance reports",
        "1 user",
      ],
      featured: false,
    },
    {
      name: "Professional",
      price: "$50",
      unit: "/seat / month",
      tagline: "For teams up to 5",
      features: [
        "Everything in Starter",
        "Competitor intelligence",
        "Priority campaign optimization",
        "Up to 5 users",
      ],
      featured: true,
    },
    {
      name: "Enterprise",
      price: "$50",
      unit: "/seat / month",
      tagline: "For unlimited users",
      features: [
        "Everything in Professional",
        "Unlimited users",
        "Dedicated account support",
        "Custom integrations",
      ],
      featured: false,
    },
  ];
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
        </div>
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border p-8 ${
                t.featured
                  ? "border-cyan-400/50 bg-gradient-to-b from-cyan-400/10 to-slate-900/40 shadow-xl shadow-cyan-500/10"
                  : "border-white/10 bg-slate-900/40"
              }`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold text-slate-950">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold text-white">{t.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{t.tagline}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-black text-white">{t.price}</span>
                <span className="text-slate-400">{t.unit}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-300">
                    <span className="mt-0.5 text-cyan-400">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#demo"
                onClick={scrollToDemo}
                className={`mt-8 block rounded-xl px-6 py-3 text-center font-bold transition ${
                  t.featured
                    ? "bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:brightness-110"
                    : "border border-white/15 text-white hover:bg-white/5"
                }`}
              >
                Book Your Free Demo
              </a>
            </div>
          ))}
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
      <div className="pointer-events-none absolute -bottom-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-3xl font-bold sm:text-4xl">
            Book your free demo.
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Tell us a little about your business. We'll show you exactly how
            EchoAI can get you more leads for less — and we'll call you within 24
            hours to set up your free onboarding.
          </p>
          <ul className="mt-8 space-y-3 text-slate-300">
            <li className="flex items-center gap-3">
              <span className="text-cyan-400">✓</span> A real call, not a sales bot
            </li>
            <li className="flex items-center gap-3">
              <span className="text-cyan-400">✓</span> Free personal onboarding
            </li>
            <li className="flex items-center gap-3">
              <span className="text-cyan-400">✓</span> No commitment required
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
    <footer className="border-t border-white/5 bg-slate-950 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-slate-500 sm:flex-row">
        <span className="font-extrabold text-white">
          Echo<span className="text-cyan-400">AI</span>
        </span>
        <span>© {new Date().getFullYear()} EchoAI. AI-powered marketing on autopilot.</span>
      </div>
    </footer>
  );
}
