---
name: EchoAI background-refresh spinner collapse
description: List components whose load() shows a spinner on every refresh silently wipe inline confirmation UI.
---
A list section (e.g. DripSequences) whose `load()` unconditionally does `setLoading(true)` will swap the whole list for a spinner on EVERY refresh — including background refreshes triggered from a child (retry a failed recipient → onChanged → load()). That unmounts inline panels and their local state, so transient success feedback like "Queued for retry" appears and is instantly wiped before the owner sees it.

**Why:** the retry confirmation lived in a child component's `retriedIds` state; the parent reload collapsed the list and remounted the child fresh, discarding it.

**How to apply:** guard the full-page loading state to the *first* load only (a `loadedOnce` ref), so subsequent refreshes update data in place without unmounting inline panels. Keeps list keys stable → child state (open/closed, per-row confirmations) survives the refresh.
