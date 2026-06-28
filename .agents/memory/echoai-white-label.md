---
name: EchoAI white-label agency ownership model
description: Why createAgency accepts ownerEmail and how agency↔customer ownership is shaped.
---

# White-label ownership model (`/api/agencies`, migration 025)

- `agencies.owner_user_id` is **UNIQUE** → each account owns at most one agency,
  so the Agency Portal has a single deterministic agency to manage and
  `getAgencySettings` can scope by `owner_user_id = req.user.userId`.
- `agency_customers.customer_user_id` is **UNIQUE** → a customer belongs to one
  agency. Unique violations surface as **409**.
- **createAgency is admin-only and accepts an optional `ownerEmail`** that
  assigns the new agency to an existing user (defaults to the authenticated
  admin if omitted).

**Why:** with owner=creating-admin and UNIQUE(owner_user_id), a single admin
could only ever create ONE agency, making the admin "view all agencies / total
revenue" overview meaningless and leaving no way to give a real reseller their
own per-owner portal. ownerEmail is the seam that lets the platform owner create
agencies *for other accounts*.

**How to apply:** keep ownerEmail on createAgency. If the prompt/spec ever drops
the UNIQUE on owner_user_id (multiple agencies per owner), revisit how
getAgencySettings picks "the" agency (it currently assumes exactly one).
