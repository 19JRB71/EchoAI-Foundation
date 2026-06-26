---
name: EchoAI black & gold theme contrast rules
description: Contrast rules for the gold accent palette in the EchoAI client, learned during the black/gold restyle
---

The EchoAI client uses a black + gold theme: dark surfaces are `bg-black`
(landing/login/sidebar), accents are Tailwind `amber`/`yellow`. Two contrast
rules were learned the hard way (a code review caught violations after a
mechanical hue swap):

- **Gold buttons must use dark text.** `bg-amber-400/500/600` with `text-white`
  fails WCAG AA (~2.5–3:1). Always pair amber/gold button backgrounds with
  `text-gray-900` / `text-black`. The landing gold gradient CTAs use
  `text-black`.
- **Amber text on white must be `amber-700` or darker.** On light dashboard/
  admin/onboarding/login surfaces, `text-amber-400/500/600` on white is below
  AA for normal text. Use `text-amber-700+`. On the dark surfaces (landing,
  sidebar) bright `text-amber-400` is fine and intentional.

**Why:** gold is intrinsically light, so white-on-gold and gold-on-white both
fail contrast; the look depends on dark-on-gold and gold-on-dark.

**How to apply:** when adding new buttons/links/labels, or doing another hue
swap, branch on surface: dark surface → bright amber accent; light surface →
amber-700+ text and amber-500 backgrounds with dark text.

## Dark-mode conversion (whole app is now dark)

The entire client is dark: page shell `bg-black`, cards `bg-gray-900` with
`border-gray-800`, nested panels `bg-gray-800`, light gold panels are
`bg-amber-500/10` or `/15`, body text `text-gray-100/300/400`, gold accent text
`text-amber-300/400`. Landing/sidebar were already dark.

Gotchas when restyling Tailwind by find/replace:
- **Gold buttons keep dark text even in dark mode.** `bg-amber-500/600 +
  text-gray-900` is the invariant. When doing a `text-gray-900 -> text-gray-100`
  dark-mode swap, protect/restore the gold-button dark text or you reintroduce
  the white(ish)-on-gold contrast bug.
- **Gradient stops are separate tokens.** `bg-*` rules miss `from-*`/`to-*`/
  `via-*` (e.g. `from-amber-50 to-white` survived a `bg-white`/`bg-amber-50`
  swap). Sweep gradient stops explicitly.
- **`<select>`/`<input>` need an explicit `text-*`.** On a dark `bg-gray-900`
  control with no text color, the browser default is dark text → invisible. Add
  `text-gray-100`.
- **`amber-50` is a substring of `amber-500`.** Use a `\b`/non-digit guard in
  sed so `bg-amber-50` rules don't corrupt `bg-amber-500`.
