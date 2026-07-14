---
name: EchoAI post graphic attachment
description: Rules for attaching generated graphics to social posts and where scheduled-post views read image_url
---
- Generated post graphics must be persisted immediately (DALL-E URLs expire) and the SAVED relative path (/uploads/images/...) attached at schedule time; schedulePost only accepts that path shape (SSRF guard).
- **Why:** temp AI URLs die within ~2h and arbitrary client URLs would make the publisher fetch attacker-controlled hosts.
- **How to apply:** scheduled posts render in TWO views backed by DIFFERENT endpoints — AI Calendar (/api/content-calendar/:brandId, contentCalendarController.getCalendar) and Post Schedule (/api/social/calendar, getSocialCalendar). Any new social_posts column shown in the UI must be added to BOTH selects and BOTH renderers.
