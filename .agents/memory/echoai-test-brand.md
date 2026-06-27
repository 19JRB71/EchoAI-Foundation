---
name: EchoAI test-brand workflow
description: How to end-to-end test brand-scoped EchoAI endpoints when the only login is the admin account.
---

# Testing brand-scoped endpoints

The admin account (`$ADMIN_EMAIL`/`$ADMIN_PASSWORD`) has **no brand**, but every
customer feature is brand-scoped and guarded by `getOwnedBrand(userId, brandId)`.

**Workflow:**
1. Login via `POST /api/auth/login` → capture `token`.
2. Create a throwaway brand: `POST /api/brands` with body `{"name":"..."}`
   (only `name` is accepted; other fields are set later via update).
3. Seed real rows directly with `psql "$DATABASE_URL"`. Watch column names —
   leads use `lead_name` (not `name`); campaigns require a non-null `user_id`.
4. Hit the endpoints, verify the math.
5. **Delete everything**: child rows first (roi_snapshots, analytics, campaigns,
   leads, …) then the brand. Leave the DB as you found it.

**Gotcha:** bash `UID` is a readonly variable — never use it as a shell var name
when passing the owner user_id into a heredoc; use `OWNER` or similar.
