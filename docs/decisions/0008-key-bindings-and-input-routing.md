# 0008 — Key bindings and input routing

Date: 2026-11-09 · Status: proposed (implementation: TBD; before external plugins)

## Context

The TUI routes keys with one primitive — Ink's `useInput((input, key) => …, { isActive })` —
and builds everything on top of it. [0003](./0003-workspace-layout-and-leader-key.md) added the
leader key and the "one focused panel owns the single letters, everything global lives under the
leader" model. That model is right; the **mechanism** underneath it has three limits that surface
as the TUI and the plugin surface grow:

1. **Focus is arbitrated by hand.** The invariant _exactly one `useInput` is active at a time_ is
   not enforced anywhere central: every component recomputes it as a boolean
   (`isActive: !modal && !leader.pending`, `NoteList.tsx:113`). There are ~14 `useInput` sites.
   The invariant is correct today, but it does not compose: adding a new overlay (a command
   palette, a second modal kind) means auditing every screen's boolean. Miss one and two handlers
   fire on one key, or the keyboard goes dead.
2. **Key maps are imperative and scattered.** Each screen's bindings live inside a `switch`-like
   `useInput` body (`NoteList.tsx:96-114`). They cannot be listed for help, checked for
   collisions, or shown in the which-key popup except by the hand-maintained `hints` array.
3. **Bindings are hard-coded.** A user cannot remap a key. `0003` made _layouts_ and the _leader_
   configurable in `tui:`; the bindings themselves are still fixed in the source.

Two forces make this worth fixing now rather than later. First, bindings **must be configurable**
(the trigger for this ADR). Second, the input surface is about to become part of the **external
plugin contract** (OpenFormLink, runtime-installed extensions): a plugin declares actions, and the
contract that carries them must be serializable data — stable ids and key tokens, never a live
key-handling function crossing the boundary (see the runtime-agnostic protocol vision in
`docs/plugins.md` direction notes).

## Decision

Three moves, each small, together replacing the hand-rolled focus booleans with one model.

### 1. A central input-layer arbiter

Input routing becomes a **priority stack of layers** held in a `KeyRouter` context. A region of
the UI registers a layer with a **role**; the router delivers each keypress to the **topmost
active layer only**. Roles, in ascending precedence:

```
screen  <  panel  <  leader  <  modal
```

A `modal` layer (prompt, confirm, picker) suppresses the `leader`, which suppresses a focused
`panel`, which suppresses the `screen` — automatically, because the router walks the stack
top-down to the first active layer and stops. No component computes `!modal && !leader` any more.

```ts
// one hook replaces the per-component isActive boolean
useKeyLayer(role: 'screen' | 'panel' | 'leader' | 'modal', keymap: KeyMap, active = true): void;
```

The router is a pure reducer over the registered layers plus the pressed key → the one binding to
run; it is unit-testable without rendering, the way the screen-stack reducer already is.

### 2. Declarative key maps with stable action ids

A layer no longer hand-writes a `useInput` body. It declares a **key map**: a list of bindings,
each with a **stable action id**, the keys that trigger it, a label, and the handler.

```ts
interface Binding {
  readonly id: string; // stable, namespaced: 'list.open', 'note.edit', 'courses.lesson.done'
  readonly label: string; // shown in which-key and help
  readonly keys: readonly KeyToken[]; // DEFAULTS; user config overrides by id
  run(): void | Promise<void>;
}
type KeyMap = readonly Binding[];
```

Because bindings are data keyed by a stable id:

- **Introspection** — which-key, the hints line, `capabilities --json`, and a future config UI all
  read the same list instead of a hand-kept `hints` array.
- **Collision checking** — within a layer, and across the leader namespace, at build time; this
  generalises the chord-collision rule `0003` already defined (`docs/plugins.md` §4).
- **Rebinding** — the `keys` are defaults; the effective keys come from config (move 3).

The leader/chords from `0003` become ordinary bindings in the `leader` layer, so the which-key
popup is generated from data and chords are rebindable like everything else.

### 3. User-configurable bindings

Extend `0003`'s `tui:` user-config block with a `keys:` map from **action id → key(s)**, merged
over the built-in defaults. Bindings are a preference, so they live user-level, like layouts.

```yaml
# ~/.config/ofl/config.yaml
tui:
  leader: ' '
  keys:
    list.open: enter # rebind a single action
    note.edit: e
    list.delete: [d, delete] # several keys for one action
    courses.lesson.done: d # a plugin action, by its namespaced id
    core.quit: Q # structural keys are rebindable except a small reserved set
```

- **Resolution**: built-in defaults ← user `tui.keys`. (A vault may _suggest_ workflow defaults in
  `.notes/config.yaml`; the user's choice wins — same precedence rule as layouts in `0003`.)
- **Key tokens**: printable chars literal (`a`, `D`, `/`); named specials (`enter`, `esc`,
  `space`, `tab`, `backspace`, `up`/`down`/`left`/`right`); `ctrl+o`-style modifiers **only where
  Ink reliably delivers them** (`0003` notes `Alt` and several `Ctrl` combos are unreliable across
  terminals — so the leader, not modifiers, stays the primary extensibility). Chord sequences are
  written with spaces: `space d`.
- **Validation is non-fatal**: an unknown action id, an unparseable token, or two actions bound to
  the same key in one layer are reported in the status line at start — never a crash, exactly as a
  broken `layouts:` entry is in `0003`.
- **Reserved set**: a few structural keys may be declared un-rebindable (escape as "cancel/back",
  the leader itself) to guarantee the UI is never trapped. Kept as small as possible.

### Plugin-contributed actions stay serializable

A plugin declares an action as **data** — `{ id, defaultKeys, label, appliesTo }` — with its `run`
executing in the plugin's own context, never as a key handler the core holds. Ids are namespaced
`<plugin>.<action>`. Users rebind by id. This is the serialization-boundary discipline the
OpenFormLink protocol vision requires: **ids and key tokens cross the boundary, key-dispatch code
does not.** A Rust/Go core could own the router, the keymap and the config and dispatch action ids
to an out-of-process plugin over the protocol with no change to this model.

## Why these and not the alternatives

- **Keep the manual `isActive` booleans**: correct today, but does not compose as overlays grow,
  cannot be introspected, and cannot be made configurable — the three things this ADR needs.
- **Ink's `useFocus` / `useFocusManager`**: a Tab-cycling form-focus model that fights a
  modal/stack app; the TUI deliberately does not use it. The layer arbiter is the stack-shaped
  equivalent.
- **Hard-coded key maps without ids**: still not rebindable or listable; the stable id is the
  thing that makes config, help, and the plugin boundary all work.
- **A full modal/vim mode system**: heavier than needed; the role stack plus the leader already
  express "the modal/leader/panel has the keys now" without a mode register.

## Consequences

- **Supersedes the _Keys_ half of `0003`'s Decision.** The leader, the focus model and the
  chord-collision rule stay; their _mechanism_ becomes the arbiter + declarative key maps, and
  chords become rebindable bindings. `0003`'s layout half is untouched.
- **Code**: a new `KeyRouter`/`useKeyLayer` in `src/interfaces/tui`; `chords.tsx` and `keys.ts`
  refactor from imperative predicates to declared bindings; each screen's `useInput` body becomes a
  `KeyMap` registered through a layer; `UserConfig.tui` gains `keys`, validated in the user-config
  adapter (the TUI receives the parsed map, never the YAML).
- **`docs/plugins.md` §4**: `PanelAction` and panel chords gain a stable `id` and `defaultKeys`;
  `capabilities --json` lists action ids with their default and effective bindings, so the hub,
  the docs, and a future config UI can show and edit them.
- **Tests**: the router (layer-stack resolution) and the binding merge/validation are pure and
  unit-tested; the leader, modal and which-key flows go through the Ink harness as today.
- **Coordination**: `PanelAction`/`PanelContext` are being edited in the courses-D work right now;
  the action-id addition touches that surface, so this should land with or just after it, not race
  it. The surface is about to become the external plugin contract, so it is worth freezing here.

## Open questions

- Per-vault binding overrides, or user-level only? (Leaning user-level, with vault _suggestions_.)
- How large is the reserved, un-rebindable key set? (Leaning: only "cancel/back" and the leader.)
- Depth of chord rebinding — single post-leader key, or arbitrary sequences?
