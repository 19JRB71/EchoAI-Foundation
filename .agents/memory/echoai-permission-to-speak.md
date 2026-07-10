---
name: EchoAI permission-to-speak gate
description: The voice "ask before speaking a proactive alert" gate and the capability-bypass invariant that keeps alerts from being trapped forever.
---

# Permission-to-speak gate (proactive server alerts)

Before Echo speaks any proactive server alert (queue items with a
`notificationId`), he first asks "Excuse me Sir, do you have a moment?" and
waits for a spoken yes/no. The gate lives across two files that talk via
`window` CustomEvents:

- VoiceContext owns the queue + an `alertPermissionRef` state machine
  (`idle`→`asking`→`granted`/`deferred`). It holds all `notificationId` items
  while `asking`/`deferred`, dispatches `echoai:permission-request`, and listens
  for `echoai:permission-answer` / `echoai:permission-retrieve`.
- EchoConversationContext interprets the owner's spoken reply and emits those
  answer/retrieve events; a nav/music command always counts as "something else"
  (hold quietly), never a yes.

## Invariant: never hold an alert you can't be released from

**Rule:** any voice gate that holds items pending a *spoken* answer MUST first
check whether Echo can actually hear one. If the mic is unsupported, opted out,
or muted, bypass the handshake and deliver the item directly (the pre-feature
behavior) — do NOT enter/stay in the holding state.

**Why:** TTS (speaking the ask) works with no mic, but STT (hearing the answer)
does not. Asking when no answer can arrive traps the alert forever — it is never
delivered and never retrievable. This is a real regression path because these
alerts play unconditionally without the gate.

**How to apply:** VoiceContext consults a `registerVoiceInputCapableProbe`
probe (mirrors the existing `registerConversationBusyProbe` pattern) that the
conversation engine backs with `supported && enabledRef.current &&
!mutedRef.current`. Checked at the moment the gate would enter `asking`. When
mic is enabled+supported, holding indefinitely until the owner says "Hey Echo,
what did you need?" is BY DESIGN correct — do not add a delivery timeout there.

Reset `alertPermissionRef` to `idle` in both `stopAll` and deactivate, and clear
`pendingPermissionRef` on interrupt (barge-in) and logout, or a stale hold
survives into the next session.
