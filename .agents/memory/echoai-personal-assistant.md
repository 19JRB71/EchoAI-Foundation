---
name: EchoAI personal assistant (reminders + tasks)
description: Durable lessons from building Echo's voice reminders/tasks — owner phone source, intent routing order, numbered-list id resolution.
---

- **Owner SMS needs `users.phone`.** Nothing else in the schema stores the owner's own mobile — `sales_agent_config.owner_phone`, `team_members.phone` etc. are other people's numbers. Any "text the owner" feature must read `users.phone` (added by the personal-assistant work, editable in Settings → Profile). Server normalizes to E.164 and defaults a bare 10-digit number to +1 — `normalizeE164` alone does NOT add the country code, and Twilio rejects `+5551234567`.
- **Voice intent routing order.** In the conversation pipeline, an explicit navigation command must win over the assistant matcher (`!matchNavIntent(text) && matchAssistantIntent(text)`) or "take me to my task list" becomes a list-tasks command instead of opening the section.
- **Numbered-list id resolution.** The AI command endpoint replies to "list" intents with numbered items in a stable order so "mark off number two" can be resolved server-side without the client tracking ids. Keep list ordering identical between the list reply and the complete/cancel resolution query.
- **Why:** reminders promise real delivery — a silent Twilio rejection or a hijacked nav command looks like Echo "forgot", which destroys trust in the assistant.
- **How to apply:** any new owner-notification channel or voice-command family should reuse `users.phone`, the nav-first routing guard, and numbered-list resolution rather than inventing parallel mechanisms.
