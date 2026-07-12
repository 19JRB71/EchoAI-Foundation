# Mission Control — Implementation Plan (awaiting approval)

**Reference:** ChatGPT concept image + Official Design Specification V1 (July 12, 2026)
**Status:** Analysis only. No code written. Implementation starts only on your instruction.

---

## 1. Feasibility verdict

The concept is implementable with high fidelity. Roughly **85% of the data it shows already exists** in the platform as real, live numbers. The remaining 15% needs one new backend aggregation endpoint and a small score-history table — no changes to business logic, APIs, databases, automations, routing, or integrations beyond that addition.

Six items need your decision before build (Section 7). Everything else is a faithful translation.

---

## 2. Component hierarchy

```
MissionControl (rebuilt sections/MissionControl.jsx)
├── ExecutiveSidebar                  (restyled existing Sidebar.jsx)
│   ├── AgentRosterItem × 9           (Phase 1 AgentCard, restyled to spec)
│   └── BrandFooterCard
├── TopBar
│   ├── SearchCommand (⌘K)            → decision #1
│   ├── NotificationBell              (wired to real attention count)
│   ├── VoiceStatusIcon               (mirrors Core state)
│   └── UserMenu                      (existing profile data)
├── BriefingHeader
│   ├── Greeting                      (existing time-of-day greeting logic)
│   ├── DateLine
│   └── CustomizeBriefingButton       → decision #2
├── KpiRow
│   └── StatCard × 6                  (tasks, appointments, calls, leads,
│                                      revenue impact, time saved + vs-yesterday deltas)
├── CoreHero
│   ├── ZorechoCore                   (Phase 1 orb, upgraded: center waveform,
│   │                                  listening/thinking/speaking/critical states)
│   ├── AgentNode × 9                 (4 left, 5 right, colored connector to Core)
│   ├── ConnectorLayer                (SVG paths + traveling colored pulse dots)
│   ├── CoreStatusLine                ("AI Company Operating at Full Capacity" — honest variants)
│   └── TalkToEchoButton              (starts existing voice engine; replaces old voice panel)
├── RightRail
│   ├── ZorechoScoreCard              (real goals overallScore → letter grade + sparkline)
│   ├── ActivityFeed                  (new unified cross-agent feed, real events only)
│   ├── NeedsAttentionPanel           (existing attention data, restyled)
│   └── ExecutiveInsightsPanel        (replaces old Echo Voice panel, per spec)
├── BottomRow
│   ├── TodayAtAGlance                (6 real daily counts)
│   ├── RevenueImpactChart            (existing ROI data, Phase 1 chartTheme)
│   ├── TimeAutomatedDonut            (existing activity-based estimate, labeled as estimate)
│   └── TopOpportunitiesPanel         (existing insights/suggestions data)
└── StatusFooter
    ├── AwayAccomplishmentQuote       (from real activity since last login)
    ├── SystemStatus                  (existing health monitor)
    ├── SecurityBadge                 (true claim: AES-256 encryption at rest)
    ├── LastBackup                    → decision #3
    └── ClockBlock
```

## 3. Reusable components (used again in Departments, Reports, Settings, Admin)

From Phase 1 kit, adapted to this spec: **Button, Card/GlassCard, StatusDot (honest vocabulary), AgentCard, ZorechoCore, Toast, chartTheme, BarsLoader**.
New and reusable beyond Mission Control: **StatCard** (metric + delta), **PanelHeader** (title + "View All →" link), **ActivityRow** (icon, agent color, text, real timestamp), **PriorityTag** (High/Medium), **DonutGauge**, **Sparkline**, **AgentNode + ConnectorLayer** (reused on Department pages at smaller scale), **SectionShell** (page frame: sidebar + topbar + footer — becomes the "rooms in the same building" chassis for every future screen).

---

## 4. Data requirements — what's real today

| Concept element | Real data source (existing) |
|---|---|
| Greeting + briefing line | mission-control endpoint briefing + time-of-day greeting logic |
| Tasks completed | mission-control 7d metrics (needs day-bucketing for "vs yesterday") |
| Appointments booked | appointments API |
| Calls answered | phone agent call log (Pro feature) |
| Leads followed up | leads + autonomous conversations |
| Revenue impact | ROI dashboard (activity-based estimate — will be labeled as such) |
| Time saved / automated % | ROI time-saved estimate (labeled as estimate) |
| Agent roster + live status | existing agents API (honest statuses, real current task) |
| Zorecho Score | goals overview overallScore 0–100 → letter grade mapping |
| Needs Your Attention | mission-control attention array |
| Top Opportunities | Sage insights + proactive suggestions (real usage gaps) |
| Executive Insights | Sage brief (Enterprise feature) |
| System status | health monitor |
| Failed posts, goal alerts, upcoming actions | already in current Mission Control — will be folded into Activity Feed / Attention panels so nothing is lost |

**Honesty rule enforced throughout:** a brand-new account shows real zeros and "not connected yet" states — never the concept image's demo numbers. Timestamps like "2m ago" appear only for real events.

## 5. Backend requirements (small, additive)

1. **One new aggregation endpoint** — `GET /api/agents/mission-control/v2` (or extend the existing one): single response with KPI counts + day-over-day deltas, unified activity feed (SQL union over existing tables' real timestamps: posts published, calls answered, leads captured, appointments, Sentinel fixes, reviews responded), attention items, footer status. One round-trip instead of ~10 client calls. Read-only; no schema change.
2. **Score history snapshots** — one tiny table + a daily snapshot (piggybacks on the existing goal-snapshot cron) so the Zorecho Score sparkline is real. It starts as a short line and grows — no fabricated history.
3. **Nothing else.** No changes to routes, automations, integrations, or business logic. `Talk to Echo` wires to the existing voice engine entry point.

---

## 6. Performance & accessibility

**Performance**
- Core hero FX (waveform, orbiting particles, connector pulses) built with CSS transforms/opacity + one lightweight canvas for the waveform — GPU-cheap; no layout-shifting animation. Particle counts capped; connector pulses are staggered, not simultaneous.
- Glass surfaces capped ~3/screen (Phase 1 rule kept).
- One aggregated API call on load + gentle polling (~45s) for the live feed; visibility-paused when tab is hidden.
- Core FX module lazy-loaded so the rest of the dashboard paints first.

**Accessibility**
- `prefers-reduced-motion`: Core goes static-lit, connectors become steady colored lines, state shown by color + text label.
- Status is never color-alone — every dot pairs with its label (honest vocabulary preserved).
- Activity feed is an `aria-live` polite region; keyboard focus order follows visual order; Talk to Echo is a real focusable button with a visible focus ring.
- Dim text kept above WCAG AA contrast on the deep-black surfaces.

---

## 7. Decisions needed from you (the only deviations/questions)

1. **Search bar (⌘K):** no global search exists today. Option A (recommended): v1 ships it as a quick-jump — type to open any section/agent/lead. Option B: omit until a later phase. Building true full-text search across all data is its own project.
2. **"Customize Briefing" button:** no briefing-customization feature exists. Option A (recommended): defer — omit the button in v1. Option B: v1 opens a simple preferences modal (which metrics to feature). 
3. **"Last Backup 2 min ago":** the platform doesn't run its own backups (the database is managed by the host). Showing a backup time we can't verify would violate the honesty rule. Recommendation: replace with a real signal — "Database: Connected · healthy" from the health monitor.
4. **Tier gating:** Calls (Pro), Executive Insights/Sage (Enterprise). For lower tiers, should those panels show a premium upgrade prompt in the same visual style (recommended, matches existing FeatureGate pattern), or be hidden entirely?
5. **The neon network beams:** the concept's beam glow is at illustration intensity. Per the motion philosophy ("calm, premium, purposeful"), I'll implement the same geometry with slightly restrained bloom so it stays readable and fast on ordinary laptops. Screenshots come back to you for judgment — flagging now per the "explain before changing" rule.
6. **Old Mission Control content:** goals rows, geographic coverage, and failed-posts feed exist today but aren't in the concept. Recommendation: fold them into Attention/Activity (nothing lost, nothing added visually). Alternative: drop from Mission Control and leave them in their own sections.

---

## 8. Effort estimate

| Stage | Work | Estimate |
|---|---|---|
| 1 | Backend aggregation endpoint + score snapshots + tests | ~half a working session |
| 2 | Page chassis: sidebar, topbar, footer, layout grid, KPI row, right rail, bottom row (all real data) | ~1 session |
| 3 | Core hero: upgraded orb, agent nodes, connectors, Talk to Echo wiring | ~1 session |
| 4 | Polish pass, mobile layout, reduced-motion, tests, screenshot package back to you | ~half–1 session |

**Total: roughly 3–4 working sessions**, delivered in that order with screenshots after stages 2, 3, and 4 for the revision loop. Existing pages stay untouched until this screen is approved; the new Mission Control can be built behind the same admin-only preview pattern as Phase 1 so you approve it before customers see it.
