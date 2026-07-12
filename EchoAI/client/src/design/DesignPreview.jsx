// ZORECHO DESIGN PREVIEW — the permanent internal design reference.
//
// Admin-only, unlinked route: /dashboard is the app; this lives at
// /design-preview. It renders every token, component, interaction and Core
// state side by side so the design language can be reviewed on one screen.
// Nothing in production imports from this page.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { AGENTS_META } from "../lib/departments.js";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  TextArea,
  Select,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Badge,
  StatusDot,
  STATUS_META,
  AgentCard,
  BarsLoader,
  ZorechoCore,
  Toast,
  CHART,
} from "../components/ui";

/* ---------- page scaffolding ---------- */

function Section({ id, title, note, children }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-semibold tracking-tight text-z-text">{title}</h2>
      {note && <p className="mt-1 max-w-2xl text-sm text-z-dim">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Swatch({ name, value, varName }) {
  return (
    <div className="flex items-center gap-3 rounded-z-ctrl border border-z-line bg-z-surface px-3 py-2.5">
      <span
        className="h-8 w-8 shrink-0 rounded-lg border border-z-line"
        style={{ backgroundColor: value }}
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-z-text">{name}</span>
        <span className="block truncate font-mono text-[11px] text-z-faint">
          {varName} · {value}
        </span>
      </span>
    </div>
  );
}

/* ---------- interactive demos ---------- */

function CoreLab() {
  const [state, setState] = useState("idle");
  const [health, setHealth] = useState("ok");
  const [pulse, setPulse] = useState(null);

  return (
    <Card glass>
      <CardBody className="flex flex-col items-center gap-8 py-10 lg:flex-row lg:justify-center lg:gap-16">
        <div className="flex flex-col items-center gap-4">
          <ZorechoCore state={state} health={health} pulse={pulse} size={200} />
          <p className="text-xs uppercase tracking-widest text-z-faint">
            Zorecho Core — {state} · {health}
          </p>
        </div>
        <div className="w-full max-w-xs space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-z-dim">
              State
            </p>
            <div className="flex flex-wrap gap-2">
              {["idle", "listening", "thinking", "speaking"].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={state === s ? "primary" : "secondary"}
                  onClick={() => setState(s)}
                >
                  {s[0].toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-z-dim">
              System health
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                ["ok", "Healthy"],
                ["warn", "Minor attention"],
                ["critical", "Critical"],
              ].map(([h, label]) => (
                <Button
                  key={h}
                  size="sm"
                  variant={health === h ? "primary" : "secondary"}
                  onClick={() => setHealth(h)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-z-dim">
              Agent activity pulse
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AGENTS_META.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setPulse({ color: a.color, key: Date.now() })}
                  title={`${a.name} completes work`}
                  className="h-7 w-7 rounded-full text-[11px] font-bold transition-transform duration-150 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-z-cyan/60"
                  style={{
                    color: a.color,
                    backgroundColor: `${a.color}1a`,
                    boxShadow: `inset 0 0 0 1px ${a.color}55`,
                  }}
                >
                  {a.name[0]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-z-faint">
              Tap an agent — its colored pulse travels into the Core.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function RosterDemo() {
  const [active, setActive] = useState("echo");
  // Honest demo statuses — labels from the approved status vocabulary only.
  const demo = {
    echo: { status: "running", activity: "Preparing the morning briefing" },
    scout: { status: "waiting", activity: null },
    atlas: { status: "needs_connection", activity: null },
    nova: { status: "running", activity: "Publishing scheduled content" },
    pulse: { status: "running", activity: "Following up leads" },
    voice: { status: "paused", activity: null },
    forge: { status: "waiting", activity: null },
    sentinel: { status: "attention", activity: null },
    sage: { status: "waiting", activity: null },
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Executive roster"
          subtitle="Hover, keyboard focus and active states — click an agent"
        />
        <CardBody className="space-y-1 px-2.5">
          {AGENTS_META.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              status={demo[a.id].status}
              activity={demo[a.id].activity}
              active={active === a.id}
              onClick={() => setActive(a.id)}
            />
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Honest status vocabulary"
          subtitle="The only approved labels — activity is never faked"
        />
        <CardBody className="space-y-3">
          {Object.keys(STATUS_META).map((s) => (
            <div key={s} className="flex items-center justify-between gap-4">
              <StatusDot status={s} />
              <span className="font-mono text-[11px] text-z-faint">{s}</span>
            </div>
          ))}
          <p className="pt-2 text-xs leading-relaxed text-z-faint">
            An agent line may additionally show a real current activity (from
            live platform data). If real-time status is unavailable, the label
            alone is shown. Fabricated activity is prohibited.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function ToastDemo() {
  const [toasts, setToasts] = useState([]);
  const fire = (agent) => {
    const id = Date.now();
    setToasts((t) => [
      ...t,
      {
        id,
        agent,
        title: agent ? `${agent.name} finished a task` : "System update",
        message: agent
          ? "Example notification — real notifications carry real events."
          : "Neutral system notification without a department source.",
      },
    ]);
  };
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => fire(null)}>
            System toast
          </Button>
          {AGENTS_META.slice(0, 4).map((a) => (
            <Button key={a.id} size="sm" variant="secondary" onClick={() => fire(a)}>
              {a.name} toast
            </Button>
          ))}
          {toasts.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setToasts([])}>
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {toasts.map((t) => (
            <Toast
              key={t.id}
              title={t.title}
              message={t.message}
              agent={t.agent}
              onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function VoiceDemo() {
  const [speaking, setSpeaking] = useState(true);
  return (
    <Card glass>
      <CardBody className="flex flex-col items-center gap-5 py-8">
        <ZorechoCore state={speaking ? "speaking" : "listening"} size={120} />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={speaking ? "primary" : "secondary"}
            onClick={() => setSpeaking(true)}
          >
            Echo speaking
          </Button>
          <Button
            size="sm"
            variant={!speaking ? "primary" : "secondary"}
            onClick={() => setSpeaking(false)}
          >
            Echo listening
          </Button>
        </div>
        <p className="max-w-md text-center text-xs leading-relaxed text-z-faint">
          In voice conversations the Core replaces the old orb: bars become the
          waveform while Echo talks; the ring brightens while Echo listens.
        </p>
      </CardBody>
    </Card>
  );
}

function MiniChart() {
  // Static illustrative sparkline rendered with the chart theme tokens —
  // demonstrates chart styling only (labeled as an example, not data).
  const points = [4, 7, 5, 9, 8, 12, 10, 14, 13, 16];
  const max = Math.max(...points);
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i / (points.length - 1)) * 280} ${60 - (v / max) * 52}`)
    .join(" ");
  return (
    <Card>
      <CardHeader title="Chart theme" subtitle="Example rendering only — not real data" />
      <CardBody>
        <svg viewBox="0 0 280 64" className="w-full" aria-hidden="true">
          {[0, 16, 32, 48, 64].map((y) => (
            <line key={y} x1="0" x2="280" y1={y} y2={y} stroke={CHART.grid} strokeWidth="1" />
          ))}
          <defs>
            <linearGradient id="zp-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.areaFrom} />
              <stop offset="100%" stopColor={CHART.areaTo} />
            </linearGradient>
          </defs>
          <path d={`${path} L 280 64 L 0 64 Z`} fill="url(#zp-area)" />
          <path d={path} fill="none" stroke={CHART.line} strokeWidth="2" strokeLinecap="round" />
          <circle
            cx="280"
            cy={60 - (points[points.length - 1] / max) * 52}
            r="3"
            fill={CHART.accent}
          />
        </svg>
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-z-faint">
          <span>grid {CHART.grid}</span>
          <span>line {CHART.line}</span>
          <span>accent {CHART.accent}</span>
          <span>axis {CHART.axis}</span>
        </div>
      </CardBody>
    </Card>
  );
}

/* ---------- the page ---------- */

const NAV = [
  ["typography", "Typography"],
  ["light", "Color & Light"],
  ["buttons", "Buttons"],
  ["cards", "Cards & Elevation"],
  ["forms", "Forms"],
  ["tables", "Tables"],
  ["badges", "Badges & Status"],
  ["agents", "Agent Colors & Roster"],
  ["core", "Zorecho Core"],
  ["voice", "Voice"],
  ["loading", "Loading"],
  ["notifications", "Notifications"],
  ["motion", "Motion Principles"],
];

export default function DesignPreview() {
  const [gate, setGate] = useState("checking"); // checking | ok | denied
  useEffect(() => {
    let alive = true;
    api
      .getProfile()
      .then((p) => {
        if (!alive) return;
        const role = p?.user?.role || p?.role;
        setGate(role === "admin" ? "ok" : "denied");
      })
      .catch(() => alive && setGate("denied"));
    return () => {
      alive = false;
    };
  }, []);

  const tableRows = useMemo(
    () => [
      ["Echo", "Marketing Director", "running"],
      ["Atlas", "Advertising Manager", "needs_connection"],
      ["Sentinel", "Oversight Agent", "attention"],
    ],
    []
  );

  if (gate === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--z-ink)]">
        <BarsLoader size="lg" label="Checking access…" />
      </div>
    );
  }
  if (gate === "denied") {
    return (
      <div className="font-inter flex min-h-screen items-center justify-center bg-[var(--z-ink)] px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-z-text">Internal page</p>
          <p className="mt-2 text-sm text-z-dim">
            The Design Preview is available to administrators only. Please sign
            in at <a href="/dashboard" className="text-z-cyan underline">/dashboard</a> first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="font-inter min-h-screen bg-[var(--z-ink)] text-z-text">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-z-line bg-[rgba(5,7,12,0.8)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <ZorechoCore state="idle" size={34} />
            <div>
              <h1 className="text-sm font-bold uppercase tracking-[0.2em]">
                Zorecho Design Language
              </h1>
              <p className="text-[11px] text-z-faint">
                Internal reference · Phase 1 · not linked from the product
              </p>
            </div>
          </div>
          <nav className="hidden gap-1 overflow-x-auto lg:flex">
            {NAV.slice(0, 7).map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-md px-2.5 py-1.5 text-xs text-z-dim transition-colors hover:bg-white/[0.05] hover:text-z-text"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-16 px-5 py-12">
        {/* Typography */}
        <Section
          id="typography"
          title="Typography"
          note="Inter everywhere. Large, confident headings; calm, dim supporting text; generous spacing."
        >
          <Card>
            <CardBody className="space-y-5 py-8">
              <p className="text-5xl font-bold tracking-tight">Good Morning, James.</p>
              <p className="text-2xl font-semibold tracking-tight text-z-text">
                Headquarters of your AI company.
              </p>
              <p className="max-w-xl text-base leading-relaxed text-z-dim">
                Body text is comfortable and quiet. It never competes with the
                data. Line height is generous; contrast is deliberate.
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-z-faint">
                Micro-labels are uppercase, tracked wide, and faint
              </p>
              <p className="font-mono text-xs text-z-faint">
                Monospace for identifiers and values: zorecho-core-v1
              </p>
            </CardBody>
          </Card>
        </Section>

        {/* Color & light */}
        <Section
          id="light"
          title="Color & Light"
          note="Deep black surfaces; blue is the light of the system; cyan marks live intelligence. Glow communicates state — it never flashes."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Swatch name="Ink (page)" value="#05070C" varName="--z-ink" />
            <Swatch name="Abyss (wells)" value="#030509" varName="--z-abyss" />
            <Swatch name="Surface (cards)" value="#0B111E" varName="--z-surface" />
            <Swatch name="Raised (hover)" value="#101828" varName="--z-raised" />
            <Swatch name="Blue (the light)" value="#3B82F6" varName="--z-blue" />
            <Swatch name="Cyan (intelligence)" value="#22D3EE" varName="--z-cyan" />
            <Swatch name="Text" value="#F1F5F9" varName="--z-text" />
            <Swatch name="Text dim" value="#94A3B8" varName="--z-text-dim" />
            <Swatch name="Text faint" value="#64748B" varName="--z-text-faint" />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ["Healthy", "shadow-z-glow", "border-blue-500/40"],
              ["Live / listening", "shadow-z-glow-cyan", "border-cyan-400/40"],
              ["Critical (soft, steady)", "shadow-z-glow-red", "border-red-500/40"],
            ].map(([label, glow, border]) => (
              <div
                key={label}
                className={`rounded-z-card border ${border} ${glow} bg-z-surface px-4 py-6 text-center text-sm text-z-dim`}
              >
                {label}
              </div>
            ))}
          </div>
        </Section>

        {/* Buttons */}
        <Section
          id="buttons"
          title="Buttons"
          note="Hover raises the light, never the element. Focus is a visible cyan ring. Red is reserved for destructive actions."
        >
          <Card>
            <CardBody className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary action</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Delete brand</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button loading>Working…</Button>
                <Button disabled>Disabled</Button>
                <Button variant="secondary" disabled>
                  Disabled secondary
                </Button>
              </div>
            </CardBody>
          </Card>
        </Section>

        {/* Cards */}
        <Section
          id="cards"
          title="Cards & Elevation"
          note="Elevation is expressed with light: brighter line, deeper shadow. Glass is reserved for focal surfaces (max ~3 per screen)."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader title="Solid card" subtitle="Default surface" />
              <CardBody className="text-sm text-z-dim">
                Cheap to render. Use for lists, settings, tables.
              </CardBody>
            </Card>
            <Card glass>
              <CardHeader title="Glass card" subtitle="Backdrop blur" />
              <CardBody className="text-sm text-z-dim">
                Focal surfaces: briefing, Core, voice overlays.
              </CardBody>
            </Card>
            <Card interactive accent="#14B8A6">
              <CardHeader title="Interactive card" subtitle="Hover me — agent accent" />
              <CardBody className="text-sm text-z-dim">
                Hover brightens the line and deepens the shadow. The top light
                carries the owning agent's color.
              </CardBody>
            </Card>
          </div>
        </Section>

        {/* Forms */}
        <Section
          id="forms"
          title="Forms"
          note="Recessed wells on black; the focus state is blue light. Errors are stated plainly in red text."
        >
          <Card>
            <CardBody className="grid gap-5 md:grid-cols-2">
              <Field label="Business name" hint="Shown to your customers." htmlFor="dp-name">
                <Input id="dp-name" placeholder="Carter Construction" />
              </Field>
              <Field label="Industry" htmlFor="dp-industry">
                <Select id="dp-industry" defaultValue="">
                  <option value="" disabled>
                    Choose an industry
                  </option>
                  <option>Construction</option>
                  <option>Real estate</option>
                  <option>Political campaign</option>
                </Select>
              </Field>
              <Field
                label="Email"
                error="This email is already on your team."
                htmlFor="dp-email"
              >
                <Input id="dp-email" error defaultValue="james@example.com" />
              </Field>
              <Field label="Notes" htmlFor="dp-notes">
                <TextArea id="dp-notes" placeholder="Anything Echo should know…" rows={3} />
              </Field>
            </CardBody>
          </Card>
        </Section>

        {/* Tables */}
        <Section
          id="tables"
          title="Tables"
          note="Quiet dividers, uppercase micro-headers, rows brighten on hover."
        >
          <Card>
            <Table>
              <THead>
                <TH>Agent</TH>
                <TH>Role</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {tableRows.map(([name, role, status]) => (
                  <TR key={name} interactive>
                    <TD className="font-medium">{name}</TD>
                    <TD>{role}</TD>
                    <TD>
                      <StatusDot status={status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </Section>

        {/* Badges */}
        <Section
          id="badges"
          title="Badges & Status"
          note="Color always means something. Agent badges carry the agent's permanent color."
        >
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="blue">Informational</Badge>
                <Badge tone="cyan">Zorecho</Badge>
                <Badge tone="success">Healthy</Badge>
                <Badge tone="warn">Needs attention</Badge>
                <Badge tone="danger">Critical</Badge>
                <Badge tone="neutral">Inactive</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {AGENTS_META.map((a) => (
                  <Badge key={a.id} color={a.color}>
                    {a.name}
                  </Badge>
                ))}
              </div>
            </CardBody>
          </Card>
        </Section>

        {/* Agents */}
        <Section
          id="agents"
          title="Agent Colors & the Executive Roster"
          note="Nine permanent colors, used identically everywhere: sidebar, Mission Control, charts, notifications, pulses. The sidebar is a roster, not navigation."
        >
          <RosterDemo />
        </Section>

        {/* Core */}
        <Section
          id="core"
          title="The Zorecho Core"
          note="The heart of the platform. Movement always communicates state: breathing (idle), bright ring (listening), particles + slow rotation (thinking), waveform bars (speaking), colored pulses (agent activity), steady glow (health — red is calm, never flashing)."
        >
          <CoreLab />
        </Section>

        {/* Voice */}
        <Section
          id="voice"
          title="Voice"
          note="Voice conversations center on the Core. Speaking animates the bars with Echo's voice; listening brightens the ring."
        >
          <VoiceDemo />
        </Section>

        {/* Loading */}
        <Section
          id="loading"
          title="Loading"
          note="The three-bar loader replaces spinners as pages migrate. Bars illuminate in sequence — recognizably Zorecho at any size."
        >
          <Card>
            <CardBody className="flex flex-wrap items-center gap-10">
              <BarsLoader size="sm" />
              <BarsLoader size="md" label="Loading leads…" />
              <BarsLoader size="lg" label="Echo is preparing your briefing…" />
            </CardBody>
          </Card>
        </Section>

        {/* Notifications */}
        <Section
          id="notifications"
          title="Notifications"
          note="Toasts rise and settle. A department source carries the agent's color on the left light edge."
        >
          <ToastDemo />
        </Section>

        {/* Charts */}
        <Section id="charts" title="Charts">
          <MiniChart />
        </Section>

        {/* Motion */}
        <Section
          id="motion"
          title="Motion Principles"
          note="Animation should feel like Apple, not science fiction."
        >
          <Card>
            <CardBody>
              <ul className="grid gap-3 text-sm leading-relaxed text-z-dim md:grid-cols-2">
                <li>• Every animation communicates a system state — none is decoration.</li>
                <li>• Nothing spins continuously; rotation exists only while the Core is thinking.</li>
                <li>• Nothing flashes — critical states glow softly and steadily.</li>
                <li>• Hover changes light (border, glow, background), never position.</li>
                <li>• Entrances rise 8px and settle in ~350ms, ease-out.</li>
                <li>• Transitions are 150–500ms; breathing and orbits are slow (4s+).</li>
                <li>• Reduced-motion users get a static, lit interface — state shown by color.</li>
                <li>• Glass (backdrop blur) is capped at ~3 surfaces per screen for performance.</li>
              </ul>
            </CardBody>
          </Card>
        </Section>

        <footer className="border-t border-z-line pt-6 text-center text-xs text-z-faint">
          Zorecho Design Language · Phase 1 · This page is the permanent internal
          design reference. Resize the window — every section is responsive.
        </footer>
      </main>
    </div>
  );
}
