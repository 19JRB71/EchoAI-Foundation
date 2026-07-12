# Zorecho Design Language — Phase 1 Review Package

**Date:** July 12, 2026
**Status:** Phase 1 complete and live in the app (hidden, admin-only). Awaiting your approval before Phase 2.
**Where to see it yourself:** log in as admin and go to `/design-preview`. It is not linked from anywhere in the product — customers cannot find it or see it.

**Important:** nothing customers see has changed. Every token, animation, and component added in Phase 1 is *additive*. The current amber brand color across the live product is untouched — flipping the product to the new palette is Phase 2 work, done screen by screen, after your approval.

---

## 1. Screenshots (26 total, in this folder)

### Desktop (1280px wide)

| File | What it shows |
|---|---|
| desktop-01-top.png | Page header + top of Typography and Color & Light |
| desktop-02-typography.png | Typography scale: display heading, subheading, body, micro-labels, monospace |
| desktop-03-color-light.png | Full color palette swatches with token names + hex values, glow demos |
| desktop-04-buttons.png | Buttons: primary / secondary / ghost / destructive, 3 sizes, working + disabled states |
| desktop-05-cards-hover.png | Cards & elevation, including the interactive card in its hover state |
| desktop-06-forms.png | Form fields: labels, focus ring, error state, helper text |
| desktop-07-tables.png | Table style: header treatment, row hover, alignment |
| desktop-08-badges-status.png | Badges + status dots (the honest status vocabulary) |
| desktop-09-agent-roster.png | All 9 agent colors + the Executive Roster (sidebar-style agent list) and the approved status label list |
| desktop-10-core-idle.png | **Zorecho Core — Idle** (slow breathing glow) |
| desktop-11-core-listening.png | **Core — Listening** (bright cyan ring) |
| desktop-12-core-thinking.png | **Core — Thinking** (particles + slow rotation — the only rotation in the system) |
| desktop-13-core-speaking.png | **Core — Speaking** (waveform bars) |
| desktop-14-core-agent-pulse.png | **Core — Agent Activity pulse** (Pulse's orange ring traveling into the Core) |
| desktop-15-core-critical.png | **Core — Critical health** (steady red glow — red never flashes) |
| desktop-16-voice.png | Voice presence treatment |
| desktop-17-loading.png | BarsLoader (the "Echo is working" loader) |
| desktop-18-notifications-toasts.png | Toasts: Nova (agent-colored light edge) + neutral System toast |
| desktop-19-charts.png | Chart theme: grid, line, accent, axis colors |
| desktop-20-motion.png | Motion principles summary card |

### Mobile (400px wide, retina)

| File | What it shows |
|---|---|
| mobile-01-top.png | Header + typography on a phone |
| mobile-02-buttons.png | Buttons stack correctly on small screens |
| mobile-03-forms.png | Form fields at phone width |
| mobile-04-agent-roster.png | Palette + roster on a phone |
| mobile-05-core.png | The Zorecho Core at phone width |
| mobile-06-loading.png | Loader at phone width |

---

## 2. Every file changed

One commit: `94a10d1 — Zorecho rebrand Phase 1`. 96 files changed, but most are the rebuilt client bundle and self-hosted font files. The actual source changes:

**Modified (5 files)**
| File | Change |
|---|---|
| `client/src/index.css` | +151 lines — the `--z-*` design tokens (colors, glows, radii, spacing, motion timings) and `z-*` keyframe animations, including the reduced-motion kill switch. All additive; no existing rule touched. |
| `client/tailwind.config.js` | Extended Tailwind with the z-token colors, shadows, and animations so components can use them as utility classes. |
| `client/src/main.jsx` | +9 lines — registers the unlinked `/design-preview` route and imports the Inter font weights. |
| `client/public/sw.js` | Cache version v73 → v74 so every customer's device fetches the new bundle instead of a stale cached one. |
| `client/package.json` (+lockfile) | The 2 new dependencies below. |

**New (16 files)**
| File | What it is |
|---|---|
| `client/src/design/DesignPreview.jsx` | The `/design-preview` reference page itself (720 lines). Admin-gated: it checks your role with the server before rendering; anyone else sees a denial notice. |
| `client/src/components/ui/Button.jsx` | Primary / secondary / ghost / destructive buttons, 3 sizes, loading + disabled states |
| `client/src/components/ui/Card.jsx` | Card, glass card, interactive (hover-lit) card |
| `client/src/components/ui/Input.jsx` | Input + Field (label, error, helper text) |
| `client/src/components/ui/Table.jsx` | Themed table primitives |
| `client/src/components/ui/Badge.jsx` | Badges incl. agent-colored variants |
| `client/src/components/ui/StatusDot.jsx` | Status indicator locked to the 6 honest labels: Running, Waiting, Paused, Needs Connection, Disabled, Attention Required |
| `client/src/components/ui/AgentCard.jsx` | The Executive Roster row (avatar, name, title, live status) |
| `client/src/components/ui/BarsLoader.jsx` | The waveform loading indicator |
| `client/src/components/ui/ZorechoCore.jsx` | The Core orb: idle / listening / thinking / speaking states, healthy / minor / critical health glow, agent-colored activity pulses |
| `client/src/components/ui/Toast.jsx` | Toast notification with agent-colored light edge |
| `client/src/components/ui/chartTheme.js` | Shared chart colors for Recharts |
| `client/src/components/ui/index.js` | One import point for the whole kit |
| `client/src/components/ui/ui.test.jsx` | 9 automated tests covering the kit |

Everything else in the commit is the rebuilt `client/dist/` bundle and the self-hosted Inter font files.

---

## 3. Dependencies added (2)

| Package | Why | Risk |
|---|---|---|
| `@fontsource/inter` | Self-hosts the Inter font (weights 400–800) so typography never depends on Google's servers — faster, more private, works offline in the PWA. | None — static font files. |
| `lucide-react` | Icon library chosen for Phase 2 (consistent, lightweight line icons). Installed now so the toolset is settled; **not yet used anywhere**, so it adds zero weight to the current bundle. | None yet. |

No server-side dependencies were added. No database changes.

---

## 4. Performance considerations

- **Fonts:** self-hosted Inter adds ~520 KB of font files to the build, but a real visitor only downloads the 5 Latin-subset weights their browser needs (~100 KB total, cached permanently after first load). The other language subsets sit unused unless needed.
- **JavaScript bundle:** 1.35 MB (about the same as before Phase 1 — the kit added ~1% because the new components are small and lucide-react isn't imported yet). This was already flagged before the rebrand; a proper fix is code-splitting, recommended below.
- **Animations are GPU-cheap:** everything animates opacity/transform/glow only — no layout-shifting animation. Continuous rotation exists only while the Core is thinking.
- **Glass (backdrop blur) is capped** at ~3 surfaces per screen by design rule — blur is the one expensive effect on low-end phones.
- **Reduced motion respected:** users with "reduce motion" turned on in their OS get a static, lit interface — every `z-*` animation is disabled, state shown by color alone.
- **Cache safety:** the service-worker version bump (v74) guarantees phones running the installed PWA pick up the new bundle instead of serving a stale one.

---

## 5. Recommendations before Phase 2 begins

1. **Write the Design Language document** (your addition #9). Everything is now built and photographed, so the document can be written from real, final components rather than intentions. I'd do this first — it becomes the contract Phase 2 is checked against.
2. **Decide the brand-color flip moment.** `--brand-primary` is still amber everywhere customers look. Phase 2 should flip it screen-by-screen (landing → login → onboarding), never globally in one shot, so each screen can be verified before the next.
3. **Code-split the bundle during Phase 2.** Since Phase 2 rebuilds the landing/login/onboarding screens anyway, it's the natural moment to split them out of the 1.35 MB main bundle — first-visit load gets meaningfully faster for prospects who never log in.
4. **Adopt the kit incrementally, never big-bang.** As Phase 2/2.5 touches a screen, its buttons/cards/tables should switch to the new kit. Screens not being touched keep their current styling until their turn — this keeps every deploy small and reversible.
5. **Keep the honest-status rule enforced.** StatusDot only accepts the 6 approved labels; any Phase 2 screen showing agent state must use it rather than free-typed text.

---

## 6. Verification already done

- 606/606 server tests, 338/338 client tests, production build green.
- Independent architect code review passed.
- Two end-to-end visual passes as admin (all sections, all Core states, roster, toasts, no console errors).
- Admin gate confirmed: logged-out visitors to `/design-preview` see only the "internal page" notice.

**Phase 1 stops here.** Landing page, login, onboarding (Phase 2) and Mission Control (Phase 2.5) are untouched, as agreed.
