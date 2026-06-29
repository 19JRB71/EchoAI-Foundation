---
name: EchoAI JSONB write safety
description: How to safely write request values into Postgres ::jsonb columns in EchoAI controllers
---

Any controller that writes a request-body value into a `::jsonb` column must run it through `utils/jsonb.js` `toJsonbParam(value)` (or `JSON.stringify` after validating shape). Never bind a raw string param to a `::jsonb` cast.

**Why:** Postgres rejects a bare string like `small business owners` with "invalid input syntax for type json" — valid JSON text requires the string to be quoted. This caused a 500 on `PUT /api/brands/:id` when `targetAudience` was sent as plain text. The old local helper passed strings through unchanged (the bug).

**How to apply:** `toJsonbParam` returns null for null/blank, stringifies objects/arrays, passes through `{...}`/`[...]` JSON literals, and quotes any other plain string. Most existing controllers already `JSON.stringify` internally-built objects (safe); the risk is only at sites that take free-text req.body fields.
