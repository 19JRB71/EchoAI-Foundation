---
name: EchoAI voice-narrated guided tour
description: Event contract and safety rules between TourEngine narration and the hands-free conversation engine.
---
The guided tour is voice-narrated by Echo. Contract (treat as a subsystem invariant):

- **Event contract:** TourEngine dispatches `echoai:tour-state` `{active}` on mount/unmount and listens for `echoai:tour-command` `{command: next|back|stop}`. EchoConversationContext mirrors this in `tourActiveRef` and dispatches matched commands. Any future conversation-engine refactor must keep both events working.
- **Why:** spoken "yes/next/back/stop" must drive the tour without a wake word, but only while the tour is open — otherwise ordinary speech ("stop") would close nothing / leak into normal commands.
- **How to apply:**
  - Match tour commands on FINAL recognizer results only (`matchTourCommand` over `finalRef`), clear `finalRef` and return early — prevents double-advance from one utterance.
  - Barge-in "stop" during narration: cut audio, dispatch tour `stop`, SKIP the generic interrupt ack — the tour speaks its own goodbye (stopAck).
  - The tour NEVER auto-advances; narration `onPlayed` only appends the ready-prompt (not on the last step).
  - Finish/stop paths must `voice.stopAll()` so narration doesn't outlive the tour card.
  - Command regexes are full-utterance anchored and ≤6 words so Echo's own narration ("ready to see the next one, Sir?") can't self-trigger.
  - Voice degrades silently for team members / muted (`voice.active && !voice.muted` guard); clicking Next/Back/Stop always works.
