---
name: Sage V2 Phase 3 outcome capture
description: Lessons from building lead outcome capture, attribution, and coverage displays.
---

- `leads.outcome` is a MEASUREMENT record; `conversion_status` stays the operational state. Nothing may drive behavior from `outcome`, and edits never back-propagate.
  **Why:** keeps the honesty layer from mutating pipeline behavior; owner is the authority on their own record.
- Flag-dark parity for existing endpoints: add new response fields (e.g. `outcomeCapture:true`) ONLY when the flag is on, so dark responses stay byte-identical. Client renders chips from that server signal — never a client-side flag mirror.
- `trg_leads_updated_at` (and similar triggers) reset `updated_at` on every UPDATE — tests staging stale timestamps must `ALTER TABLE ... DISABLE TRIGGER` around the staging write.
- `uniq_appointments_active_slot` is unique on (brand_id, start_time) — test fixtures inserting multiple appointments per brand need distinct start times.
- Voice-answer parsing (Hermes) fails CLOSED: unclear/error → nothing written; UI chips remain the fallback capture path. Deal values only when explicitly stated, never estimated.
- Coverage denominator is LOCKED: all leads of the brand, no time window, no exclusions (arch doc §6.1). Never narrow it (e.g. last-90-days) without a CEO-approved amendment — it silently distorts the program adoption metric.
