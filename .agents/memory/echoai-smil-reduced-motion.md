---
name: EchoAI SMIL reduced-motion gap
description: SVG SMIL animations are not stopped by the CSS .z-anim reduced-motion rule; they must be gated in JS.
---

The rule: any SVG SMIL animation (`<animateMotion>`, `<animate>`) must be gated
in JavaScript with `window.matchMedia("(prefers-reduced-motion: reduce)")` and
replaced with a static equivalent (e.g. a brightened line) for reduced-motion
users.

**Why:** the project's reduced-motion convention disables `.z-anim` CSS
animations/transitions via a media query, but SMIL runs in the SVG engine, not
CSS — putting `.z-anim` on the element does nothing. Architect review caught a
traveling connector spark still animating under reduced motion.

**How to apply:** whenever adding traveling pulses/sparks along SVG paths
(CoreHero-style connectors, landing hero demo), branch on a
`prefersReducedMotion()` check and render a static highlight instead of the
SMIL child.
