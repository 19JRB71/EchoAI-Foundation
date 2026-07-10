---
name: EchoAI Postgres UUID-vs-text single-param trap
description: One bound param compared against both a UUID column and a ->> text field fails Postgres type deduction; cast the uuid side to text.
---

# UUID column vs `payload->>'key'` text, bound to one param

When a single bound parameter is compared against **both** a UUID column and a
text expression (e.g. a JSONB `payload->>'brandId'`) in the same query —
`... AND (brand_id = $2 OR payload->>'brandId' = $2)` — Postgres cannot deduce a
single type for `$2` and the query fails at runtime with
`operator does not exist: text = uuid` (500). The `->>` side forces `$2` to text,
which then makes `uuid_col = $2` invalid.

**Fix:** cast the uuid side to text so both comparisons are text and the param is
unambiguous: `(brand_id::text = $2 OR payload->>'brandId' = $2)`. This also
tolerates a non-UUID string input without erroring (bonus robustness).

**Why:** the notification "Clear all" button silently did nothing for a
brand-scoped clear — the brand branch used one `$2` for a UUID column and a text
JSON field, the UPDATE 500'd, and the client's `clearAll()` had an empty `catch`,
so the failure was invisible. Two compounding traps: the SQL type error, and a
swallowing catch that hid it.

**How to apply:**
- Any OR/IN predicate mixing a `uuid` column and a `->>` text field against one
  bind param needs a `::text` cast on the uuid side (or separate params).
- The list/summary paths here compare brand ids as JS strings (`String(brand_id)`),
  so `brand_id::text` is the semantically consistent SQL form (client sends
  `String(brandId)`).
- **Testing:** mocked-`db.query` tests that only string-match the SQL will NOT
  catch this class of bug — they can even lock the broken SQL in. For any
  SQL-shape-sensitive query, add a real-DB (unstubbed) test that actually
  executes it (e.g. against a brand id no row matches, assert 200 not throw).
