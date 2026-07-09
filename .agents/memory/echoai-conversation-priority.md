---
name: EchoAI conversation-priority voice queue
description: How proactive speech (alerts/briefings) is held while an Echo conversation is active
---
Rule: proactive voice items must never interrupt an active conversation; interactive items always play.

**Why:** owner complained Echo interrupted himself mid-conversation with Sage alerts/briefings.

**How to apply:**
- Classifier `isProactiveVoiceItem` (conversationHelpers.js): interactive = echo_conversation/tour/status/demo-suggestion; anything with a server `notificationId` or an UNKNOWN type is proactive (fail toward not interrupting). New spoken surfaces must pick a side deliberately.
- VoiceContext drain picks the first PLAYABLE item (splice, not shift) so a held proactive head never blocks a conversation reply; all-held → break + 2s holdTimer backstop; `echoai:conversation-idle` event re-drains instantly (and clears the backstop).
- Conversation engine registers a synchronous busy probe (`registerConversationBusyProbe`): busy = mode!=='passive' || suspendRef || speakingRef — covers capture, processing, speaking, and the follow-up window; it dispatches the idle event when convState returns to passive.
- Navigation never auto-talks: nav speech only fires from spoken intents; keep it that way.
