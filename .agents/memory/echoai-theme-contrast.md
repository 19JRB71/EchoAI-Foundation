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
