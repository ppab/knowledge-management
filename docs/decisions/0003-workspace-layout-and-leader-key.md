# 0003 — A column workspace and a leader key for the TUI

Date: 2026-10-27 · Status: accepted (implementation: M7.5)

## Context

The TUI shipped as a screen stack: one full-width screen at a time, each binding its own single
letters, with panels either opened as screens (`c` calendar, `T` todos) or as a side panel that
takes the keyboard while it is open (`m` metadata, `B` backlinks). Using it surfaced two limits:

- The key namespace is full. The note screen reserves 17 single letters and plugins must dodge
  them (`RESERVED_KEYS` in `core-panels.ts`). Anything global that is added next, a toggle, a
  focus move, a plugin command, collides with something.
- People want to see more than one thing at once: the note with its backlinks beside it, the
  calendar next to the list, the todos always in view. One person wants a narrow sidebar on
  each side of the note; another wants two columns of equal width. A fixed three-slot layout
  would serve the first and fail the second.

## Decision

### The workspace is an ordered list of columns

- A **layout** is a list of columns. Each column has a **width** and a vertical **stack of
  panels**. The current screen stack (list → note → history → …) is itself a panel with the
  reserved id `main`, and it may sit in any column. Nothing in the code knows the words
  "sidebar", "left" or "right".
- Widths are **fractions or fixed cells**, as in CSS grid: `1fr`, `2fr`, `28`. Fixed columns
  are laid out first, the fractions share the rest.
- Panels in a column **share its height**, equally by default, weighted when a panel gives a
  `height` fraction.
- Layouts are **named** and live in the **user configuration** (`~/.config/notes/config.yaml`),
  because how one person arranges a terminal is a preference, not a fact about a vault. A vault
  may name a default layout in `.notes/config.yaml`; the user's choice wins.
- **Context rule.** A panel whose placement is `note` renders the note shown in `main` and is
  blank when `main` is not on a note; a `home` panel renders regardless. This reuses the
  distinction the registry already makes; no new placement is introduced.
- **Narrow terminals collapse columns from the outside in** (the column farthest from `main`
  goes first) until the remaining columns fit their minimum widths; `main` never collapses. A
  one-column layout is today's TUI, so an 80-column terminal keeps working unchanged.
- **Toggling** a column hides it and returns its width to the rest; toggling again restores it.
  Switching layouts replaces the whole arrangement. Toggles are session state, not written back
  to the configuration.

```yaml
# ~/.config/notes/config.yaml
tui:
  leader: ' ' # default
  layout: review # the layout to start in; `focus` when absent
  layouts:
    focus:
      - { width: 1fr, panels: [main] }
    review:
      - { width: 1fr, panels: [main] }
      - { width: 1fr, panels: [core.backlinks, todos.open] }
    study:
      - { width: 28, panels: [core.calendar] }
      - { width: 1fr, panels: [main] }
      - { width: 30, panels: [core.metadata, core.backlinks] }
```

`focus` always exists (built in) and is the fallback when the named layout is missing or
invalid; a broken `layouts:` entry is reported in the status line at start, never a crash.

Not decided, deliberately: nested splits (a tiling tree as in tmux or vim windows). Columns of
stacks cover the asked-for arrangements, keep focus movement one-dimensional per axis, and
keep the configuration readable. A column is already a vertical stack, so the model can grow
into a tree later without breaking existing configurations.

### Keys: single letters for the focused panel, a leader for everything else

- **Focus.** Exactly one panel has the keyboard. Its own keys are the single letters it binds
  today (`h/j/k/l`, `Enter`, `b`, `v`, `e`, `s`, panel actions, …). Those do not change.
- **Leader.** `Space` (configurable, `tui.leader`) opens a chord. Everything that is not about
  the focused panel lives under it:
  - `Space h` / `Space l` focus the column to the left / right; `Space j` / `Space k` the panel
    below / above in the column; `Space 1`…`Space 9` focus column _n_.
  - `Space t` then a column number toggles that column; `Space L` opens the layout picker.
  - `Space c` calendar, `Space m` metadata, `Space B` backlinks: the home and note panels that
    today take a single letter move here. `Space` followed by a plugin's chord opens or acts on
    its panels (`Space T` todos, as before but one chord deeper).
  - `Space ?` lists every chord; `Esc` cancels a pending chord.
- **Which-key popup.** After the leader, a popup lists the available continuations grouped as
  layout, panels, plugins. This replaces the ever-longer hints line as the discovery mechanism;
  the hints line keeps only the focused panel's keys.
- **Prompts win.** While a prompt, picker or selection owns the keyboard, `Space` is a space.
  The leader is only read when no modal flow is active.
- **Opening a panel by chord** focuses it if it is in the current layout, else shows it as a
  screen in `main` (today's behaviour) so a one-column layout loses nothing.
- **Registry rule.** Plugins declare **chords** (one or more keys after the leader), not bare
  keys. The registry rejects two equal chords and a chord that is a prefix of another at build
  time, naming both, as it rejects key collisions today. `RESERVED_KEYS` shrinks to the
  per-panel letters and no longer needs to grow with every global action.

## Why these and not the alternatives

- **Modifier chords** (`Ctrl`/`Alt`) instead of a leader: terminals deliver `Alt` inconsistently,
  several `Ctrl` combinations belong to the shell or flow control, and Ink cannot see the
  difference between some of them. A leader works on every terminal Ink runs on.
- **Fixed left/centre/right slots**: simpler to implement, but it hard-codes one arrangement
  and would need a second mechanism for "two equal columns". Columns subsume it.
- **A tiling tree**: strictly more general and strictly harder to configure, navigate and test.
  Deferred until columns of stacks prove insufficient.

## Consequences

- `docs/plugins.md` §4: `PanelSpec.key` becomes `chord`; the collision rule is restated for
  chords. The todos plugin's `T` becomes `Space T`. Existing single-letter panel keys in the
  core move under the leader in the same change.
- `docs/architecture.md` §6: the screen table describes the focused panel's keys; a workspace
  paragraph describes columns, focus and the leader. `capabilities --json` lists chords.
- `UserConfig` gains an optional `tui` section (leader, layout, layouts) validated with Zod in
  the user-config adapter; the TUI receives the parsed layout, never the YAML.
- Tests: the layout algorithm (widths, collapse order, minimums) is pure and unit-tested; the
  leader and which-key flows are tested through the Ink harness like every other key map.
- Ordering: the visual pass (theme, hints, row styling) lands before the workspace since those
  components are reused inside every column; the workspace lands before M8 because it changes
  what plugins register, which is cheaper to do while there is one plugin.
