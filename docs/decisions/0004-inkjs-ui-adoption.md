# 0004 — Adopt @inkjs/ui for the note-creation flow, keep the custom selector

Date: 2026-10-27 · Status: accepted (implementation: issue #4)

## Context

The note-creation flow (`c` → title → template → create) had two problems the rest of the TUI
did not. First, `Prompt` was an append-only field: it added and removed characters at the end
with no edit cursor, so a typo in a long title meant deleting back to it. Second, the flow was
loose state on `NoteList` (`prompt` and `choice`), and submitting the title closed the prompt
_before_ `previewTemplates` resolved. In that gap both `prompt` and `choice` were null, so the
list's single-letter keys and the leader were live: a keystroke during the preview moved the
list cursor or opened the global menu. A result that resolved after the dialog was cancelled
still reopened it.

`@inkjs/ui` offers a `TextInput` with a real cursor and a small set of status widgets. The
question was whether it fits this project's Ink 8 + React 19 and the Node-free Bun binary, and
how much of it to take.

## Spike

A throwaway harness test and a compiled-binary smoke entry (both removed with the spike branch)
established, rather than assumed:

- `@inkjs/ui@2.0.0` installs cleanly — its peer is `ink: ">=5"` and it pins no React, so Ink 8
  and React 19 both satisfy it with no `overrides`.
- `TextInput` renders through the existing Ink harness and handles a real cursor, mid-string
  insertion, paste (a multi-character input chunk inserts atomically), spaces, accents and
  emoji. Its cursor is a hardcoded `chalk.inverse`, matching the old `Prompt`'s `<Text inverse>`.
- The production binary (`bun run compile`) bundles it and runs under a PTY — no dynamic
  `require`, no native addon.
- Read from source, not inferred from the prop name: `Select`'s `onChange` fires on
  **confirmation**, not navigation; arrows move the highlight silently; there is **no `j`/`k`**;
  and confirming a pre-highlighted `defaultValue` fires nothing (`previousValue === value`).

## Decision

### Adopt three widgets, keep the selector

- **`TextInput`** for the title field. It fixes the append-only limitation directly.
- **`StatusMessage`** for the inline loading-failure, write-failure and empty-title messages, and
  **`Spinner`** for the preview and write pending states. Both pair an icon with colour, so they
  stay legible under `NO_COLOR` where the colour drops but the icon remains.
- **Keep the existing `Rows`-based template selector.** It already shows the template name and
  its projected path in aligned columns and honours `j/k`; `Select` offers none of that.

### One theme bridge, no second palette

`@inkjs/ui` colours its `Spinner` frame and `StatusMessage` icon from its own hardcoded hues via
a theme context. `components/ink-ui.tsx` maps just those to the project's role palette with
`extendTheme`, so colour comes from one source and falls silent under the project's `NO_COLOR`
toggle. `TextInput`'s theme is empty, so it needs no mapping.

### The flow is one owned state machine

`screens/create-flow.tsx` (`useCreateFlow`) holds the flow as an explicit machine —
`title → loading → select → creating`, with failures folding back into `title` (preview) or
`select` (write) carrying the message and the selection. `NoteList` turns its list keys and the
leader off whenever the flow is `active`, i.e. from the first keystroke to the last, so there is
never a null gap for another handler to read. Each async step is guarded by a liveness flag (the
same pattern as `useLoad`), so a preview or write that resolves after a cancel or unmount is
dropped instead of reopening a closed dialog. While the note is being written no key cancels it;
the dialog says it is pending and repeated `Enter` does nothing.

## Why these and not the alternatives

- **`Select`**: no `j`/`k` (against the project's vim convention), navigation is unobservable
  from props, the `defaultValue`-confirm gap, and a single-string label with no per-column role
  styling. The custom selector already does everything it would, and more.
- **`Alert`**: a bordered box that would double-border inside `Dialog` and cost scarce vertical
  lines at 40×15. `StatusMessage` carries the same icon-plus-text signal inline.
- **`Badge`**: signals by background colour (weak under `NO_COLOR`), force-uppercases, and sits
  outside the theme — decorative, not load-bearing.

`ProgressBar` and `MultiSelect` are out of scope here but recorded (on issue #6) as candidates
for the goals plugin and list-style date binding respectively; `MultiSelect` cannot represent
the calendar's 2-D grid, which keeps its own selection model.

## Consequences

- `@inkjs/ui` enters `dependencies`. The adoption is partial and deliberately narrow: other
  dialogs (search, tag, pickers, location, url/save) keep `Prompt` and the custom components
  until a later task decides otherwise.
- New: `components/ink-ui.tsx` (theme bridge) and `screens/create-flow.tsx` (the flow). The
  creation logic leaves `NoteList`, which now only mounts the flow and gates its own keys on it.
- Tests: the flow is exercised through the Ink harness (`test/tui/create.test.tsx`) — the
  editable field, keyboard ownership during the flow, the empty-title and write-failure recovery
  paths, and 40×15. The happy paths in `list.test.tsx` are unchanged and still pass.
- Shortcuts are unchanged (`c`, `j/k`, `Enter`, `Esc`), so no key documentation changes.
