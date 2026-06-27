---
name: EchoAI leads table dedup
description: Why lead de-duplication stays application-level, not a DB unique constraint
---

Dedup new chatbot leads at the **application level**: match an existing brand
lead on case-insensitive email OR phone before inserting, and only COALESCE-fill
blank fields (never overwrite).

**Why no DB unique index on `(brand_id, email)`:** the `leads` table is shared
across multiple insert paths — manual creation (`leadController`) and public
lead-qual (`publicController`) — that do not expect a uniqueness constraint. A
global unique index would regress those paths (manual re-add of a known email
would throw). Keep the constraint out; dedup where the duplicate risk actually
lives.

**How to apply:** when adding any new path that creates `leads`, dedup in code,
don't reach for a table-wide unique index.
