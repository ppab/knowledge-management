# 0002 — Hand the terminal to the external editor through Ink's `suspendTerminal`

Date: 2026-10-27 · Status: accepted

## Context

The TUI must launch Neovim on `e` and come back with the note re-rendered and the terminal in
a sane state. Ink owns raw mode, the cursor, bracketed paste and (when enabled) the alternate
screen while it runs; nvim needs all of those back for the duration of the edit. The
architecture (§6) sketched the manual sequence: drop raw mode, let Ink go quiet, spawn nvim with
`stdio: inherit`, await exit, restore raw mode, force a full redraw.

## Spike

Ink 8 ships that sequence as `useApp().suspendTerminal(callback)`: while the callback runs it
stops writing output, stops consuming input, turns raw mode off, shows the cursor, leaves the
alternate screen and disables the kitty keyboard protocol; when the callback settles (even by
throwing) it reapplies its own state and repaints from scratch. A throwaway script rendered a
one-line app with `alternateScreen: true`, suspended, spawned a child with `stdio: 'inherit'`,
and logged `process.stdin.isRaw` at each step. Under a pseudo-terminal
(`script -qfec "node handoff.mjs" /dev/null`), both with a shell that printed its tty and with
`nvim --clean '+sleep 300m' +qa`:

```
raw before suspend: true
raw during suspend: false      # the child saw /dev/pts/N in cooked mode
editor exit code: 0
raw after resume: true
raw after exit: false          # unmount restores the terminal
```

The frame was redrawn after resume without any extra bookkeeping on our side.

## Decision

- `ExternalEditor.open(file, { command? })` (infrastructure) spawns the editor with
  `stdio: 'inherit'` and resolves when it exits. It does not know about Ink. The command is the
  vault's `editor:` setting, else `$VISUAL`, else `$EDITOR`, else `nvim`; it is split on
  whitespace, never run through a shell.
- The TUI calls `suspendTerminal(() => editor.open(...))` and reloads the note afterwards. The
  CLI's `notes edit` calls the same adapter directly; there is nothing to suspend.
- The TUI renders on the alternate screen, so the user's scrollback is untouched and nvim's
  own alternate screen nests cleanly.

## Manual checklist (run before tagging a release)

1. `notes` → open a note → `e` → nvim opens with the file, cooked mode (arrow keys work in
   insert mode, `Ctrl-C` is nvim's).
2. Edit a line, `:wq` → the TUI is back, the body shows the change, the header is intact, no
   stray lines above or below the frame.
3. `e` again, `:q` without changes → same frame as before, no flicker artefacts.
4. `e`, then `:cq` → the TUI shows "editor exited with code 1" in the status line and keeps
   running.
5. Resize the terminal while in nvim, `:wq` → the TUI re-lays out to the new size.
6. `q` from the list → the shell prompt returns on the primary screen with the pre-TUI
   scrollback intact, cursor visible, typed characters echoing.

## Consequences

- An automated test asserts the raw-mode sequence `on → off (child runs) → on` around a fake
  editor through the real Ink runtime with injected streams (`test/tui/editor.test.tsx`).
- Nested suspensions throw in Ink; the TUI guards `e` while an editor is already running.
- In a non-interactive environment Ink runs the callback without a handoff. The TUI refuses
  to start without a TTY anyway, so this path only matters in tests.
