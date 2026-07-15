---
name: EchoAI clipboard image paste
description: How paste-to-upload listeners must decide whether to hijack a paste
---
Rule: a window-level paste-to-upload handler decides by clipboard CONTENT — if the clipboard holds accepted image files, upload and preventDefault regardless of which element is focused; plain-text pastes are always left alone.
**Why:** the first version skipped pastes when focus was in any INPUT/TEXTAREA (to protect the caption field). Users naturally click the nearby text box before Ctrl+V, so image pastes silently did nothing — confirmed user-reported failure while the shipped bundle was correct. Content-based branching protects text entry with zero focus traps.
**How to apply:** any paste/drop upload surface (Vision Reference Library pattern): collect image files from e.clipboardData.items first; only if non-empty, preventDefault + upload. Verify via headless synthetic ClipboardEvent dispatched with focus inside the text input (expect POST 201).
