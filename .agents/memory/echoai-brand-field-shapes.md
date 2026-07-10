---
name: EchoAI brand fields can be JSON objects, not just strings
description: Brand-discovery fields like target_audience may persist as structured objects; UI must never render them raw.
---

# EchoAI brand fields can be objects, not strings

Brand-profile fields produced by AI brand discovery (notably
`target_audience`, and potentially `brand_personality` / `voice_description`)
are sometimes persisted as **structured JSON objects/arrays** (e.g.
`target_audience = { age: "25-45", region: "TX" }`), not plain strings.

**Why:** Rendering such a value directly as a JSX child throws React error #31
("Objects are not valid as a React child"), which — because the dashboard's
crash surface is a whole-page render — blanked the entire SPA (the reported
"clicked admin … went blank" was actually the Settings "Brand profile" card).

**How to apply:** Any UI that displays a brand field must coerce it to text
first (there is a `displayValue()` helper in `sections/Settings.jsx` that
handles strings/numbers/arrays/objects). Never do `{brand.someField}` for a
field that could be object-shaped. The same applies to other AI-generated JSON
columns rendered in the client. A layered ErrorBoundary now contains such
crashes, but fix the render site too.

## brands table has NO `country` column
Any query SELECTing `country` from `brands` throws in prod (column doesn't exist). `getOwnedBrand`/`loadBrandRow`-style helpers that copy a column list are the usual culprit. Geo lives in `geo_targeting` (jsonb, areas[] shape) and only supports `"US"` as a country per `utils/geoTargeting.js` — so a `reachedCountries()`-type helper correctly defaults to `["US"]` when no country field is present. **Why:** tests that build a res/req mock and call a controller helper directly BYPASS `getOwnedBrand`, so a non-existent-column SELECT passes every unit test yet 500s on the first real request. **How to apply:** any new brand-scoped read must exercise the real ownership query in at least one test (feed/list path), not just the inner helper.
