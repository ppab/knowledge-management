# Implementation Plan — v0.1

Companion to [architecture.md](./architecture.md). Each milestone is a vertical slice that is
independently testable and leaves `main` working. Definition of done applies to every milestone:

- All listed tests pass under `bun run test`; lint, format and `tsc --noEmit` are clean.
- No layer-boundary violations (ESLint).
- No placeholder code; every exported symbol has a caller or a test.
- `notes capabilities --json` reflects the commands that exist.

```
M0 ─ M1 ─ M2 ─┬─ M3 ─┐
              ├─ M4 ─┼─ M5 ─ M6 ─ M7.5 ─┐
              ├─ M7 ────────────────────┼─ M9
              └─ M8 ─ ──────────────────┘
```

M7 (history) and M8 (export) depend only on M2/M4 and can be scheduled before the TUI if the
agent/CLI surface should land first.

---

## M0 — Bootstrap

**Objective.** A strict TypeScript project where the layer rules are enforced by tooling, and the
two riskiest infrastructure assumptions are verified before anything depends on them.

**Deliverables**

- `package.json` (ESM, `bin/notes`), `tsconfig.json` (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), Vitest, ESLint (typescript-eslint + `no-restricted-imports`
  per layer), Prettier, `bun run check` (lint + format + typecheck + test).
- `src/{domain,application,infrastructure,interfaces}` with a smoke module in each to exercise
  the boundary rules.
- Spike result recorded in `docs/decisions/0001-sqlite.md`: does `node:sqlite` on the target
  Node version ship FTS5? If not, switch to `better-sqlite3` here.
- `notes --version` runs.

**Dependencies.** None.

**Acceptance criteria**

- Importing `infrastructure` from `domain`, or `interfaces` from `application`, fails lint.
- `node -e "new (require('node:sqlite').DatabaseSync)(':memory:').exec('CREATE VIRTUAL TABLE t USING fts5(x)')"` succeeds (or the fallback decision is documented).
- `bun run check` is green on a clean clone.

**Tests.** One Vitest test per layer proving the harness runs; a lint test fixture that is
expected to fail the boundary rule.

---

## M1 — Vault and notes end to end

**Objective.** Initialize a vault, create a note from a template with a generated identity, list
and show notes — scanning the filesystem directly, no index yet.

**Deliverables**

- domain: `VaultId`, `NoteId`, `Note`, `UnidentifiedNote`, `Reference` (string grammar), identity
  strategy interface and the `formatted` composer, `Visibility`, title fallback rule.
- application: `initVault`, `locateVault`, `createNote`, `listNotes`, `showNote`, `adoptNote`,
  `renderTemplate`; ports `VaultLocator`, `NoteStore`, `MarkdownDocument`, `FrontmatterCodec`,
  `IdentityStrategy`, `TemplateRepository`, `Clock`.
- infrastructure: filesystem locator (nearest `.notes` ancestor) and store (atomic write,
  version hash), remark parser producing `ParsedNote` with positions and references from text
  nodes only, yaml frontmatter codec, `ulid` / `uuidv7` / `formatted` strategies, template
  repository with `{{title}} {{date}} {{id}} {{vault}} {{slug}}` and user variables, built-in
  `default` template.
- CLI: `init`, `create`, `list`, `show`, `adopt`, `--json`, exit codes.
- `.notes/cache/.gitignore` written at init.

**Dependencies.** M0.

**Acceptance criteria**

- `notes init` in a directory with an existing Git repo creates only `.notes/` and touches
  nothing else.
- `notes create --template adr --title "X"` writes a file at the template's output path with a
  frontmatter `id` from the configured strategy; running it twice yields distinct ids.
- A formatted strategy referencing `{type}` takes it from the template name.
- `notes show <id>` on a file whose frontmatter contains unknown keys and YAML comments prints
  them unchanged in `--raw`.
- A file matched by `include` with no `id` appears in `list --unidentified` and is rejected by
  mutations with exit `6`.
- Templates cannot write outside the vault root (exit `6`) or overwrite an existing file
  (exit `5`, `CONFLICT`).
- `adopt` takes the note type from frontmatter `type`, then `--type`; a `{type}` identity format
  with neither fails with guidance (exit `6`).
- Changing `identity.strategy` in config and creating a new note does not alter any existing id.

**Tests**

- domain: id immutability, formatted-id composition, title fallback, reference grammar
  (including rejection of `[[a b]]`, `[[a|]]`).
- application: `createNote` with fake ports (path, id, template variables, missing required
  variable error); `adoptNote` adds only `id`.
- infrastructure: frontmatter round-trip fixtures (comments, order, unknown keys, no
  frontmatter, CRLF); references ignored inside code spans and fences; atomic write leaves no
  temp files; locator finds nearest `.notes` and stops at filesystem root.
- integration: `init → create → list → show --json` in a tmp dir.

---

## M2 — Index

**Objective.** A disposable SQLite projection that gives discovery, search, backlinks and date
lookup, with incremental refresh and full rebuild.

**Deliverables**

- domain: `DateBinding`, duplicate-identity detection rule.
- application: `rebuildIndex`, `refreshIndex(paths)`, `indexStatus`, `searchNotes`,
  `lookupByTitleOrAlias`, `backlinks`, `listReferences`, `notesOnDate`, `datesInRange`,
  `diagnose` (duplicate ids, unidentified notes, dangling references, stale index); port
  `NoteIndex`.
- infrastructure: `node:sqlite` adapter with schema from architecture §4, FTS5 table, schema
  version check, incremental update keyed on `(path, version)`.
- CLI: `search`, `backlinks`, `reference list`, `index rebuild|status`, `doctor`; `list` and
  `show` now read from the index and fall back to a rebuild when the cache is absent.
- Plugin groundwork (added 2026-10-27): the `fields` table and `EntrySummary.fields` carry
  every non-core frontmatter key, so future plugins (todos, goals, expenses, …) can query by
  field without their own index.

**Dependencies.** M1.

**Status.** Done 2026-10-27. Deviations: application tests run against the real SQLite adapter
on an in-memory database rather than a hand-written fake (same reasoning as for the Markdown
parser and YAML codec); `list --json` now returns index summaries, not full notes (`show` does);
`create`/`adopt` do not yet call `refreshIndex([path])` (reads refresh on their own; the
mutation pipeline lands in M3).

**Follow-up before M5.** Write an architecture addendum defining the `NotePlugin` interface
(declared fields with types, commands, doctor checks) and the TUI panel registry, so the TUI is
built around a registry from the start. First-party plugins live under `src/plugins/<name>/`
under the same layer rules as the rest.

**Acceptance criteria**

- Deleting `.notes/cache/` and running any read command reproduces identical output.
- Editing one file and running `index status` reports exactly one stale entry; `refreshIndex`
  touches only that row.
- Two files sharing an `id` make `doctor` exit `6` and name both paths; `show <id>` exits `4`.
- `search` returns matches in title, alias and body; `--json` includes `rankInVault`.
- `backlinks <id>` lists sources whose references target the id, including unresolved targets
  flagged in `reference list`.
- Index files are never created outside `.notes/cache/`.

**Tests**

- domain: date binding set semantics; duplicate detection.
- application: search/backlinks/doctor against the in-memory `NoteIndex` fake.
- infrastructure: rebuild from fixture vault equals incremental result after a sequence of
  create/modify/delete; schema version bump triggers rebuild; FTS query escaping.
- integration: `create ×3 with references → index rebuild → backlinks → doctor --json`.

---

## M3 — Safe mutations

**Objective.** Every structured write goes through one offset-based, conflict-checked path and
can be previewed.

**Deliverables**

- domain: `TextEdit`, `applyEdits`, `InsertionLocation`, `DocumentVersion`, mutation
  post-conditions.
- application: `addReference`, `insertSnippet`, `bindDate`, `unbindDate`, `wrapSelectionAs*`
  (logic only; TUI wiring in M6), `--dry-run` diff output; `MarkdownDocument.locate`.
- infrastructure: `locate` for `AtEnd`, `UnderHeading`, `InReferencesSection` (create section
  when absent); `FrontmatterCodec.set` returning a `TextEdit`; store `write` with
  `expectedVersion`.
- CLI: `reference add`, `snippet insert`, `bind`, `--dry-run` on all three; exit `5` on
  conflict.

**Dependencies.** M2.

**Status.** Done 2026-10-27. Deviations: `locate` is pure domain logic over the parsed heading
list (`domain/text/insertion.ts`) rather than an adapter method, so the Markdown adapter only
parses; the frontmatter codec keeps returning YAML text and the use case builds the
`TextEdit` (no separate `set`); `DocumentVersion` is the existing content-hash `version`.
Snippets live in `.notes/snippets/<name>.md` with an optional `snippet: { at, variables }`
block. Every mutation now ends with a targeted `refreshIndex([path])`.

**Acceptance criteria**

- `reference add --at heading:"Design"` inserts before the next heading of equal or higher
  depth; everything outside the inserted range is byte-identical (checked by diff).
- `reference add --at references` creates a `## References` section only if none exists.
- Adding a reference to a target that resolves by alias persists the canonical id, never the
  alias.
- Modifying the file between read and write makes the command exit `5` and leave the file
  untouched.
- `bind --date 2026-10-23` twice yields one entry; `--remove` of an absent date is a no-op with
  exit `0`.
- `--dry-run` prints a unified diff and writes nothing (store fake records zero writes;
  integration checks mtime).
- Snippet with a missing required variable exits `6` before any read.

**Tests**

- domain: property test — for random edit sets, bytes outside ranges are unchanged; overlapping
  edits rejected.
- application: each use case against fakes, including conflict and post-condition failures.
- infrastructure: `locate` fixtures (nested headings, trailing whitespace, no trailing newline,
  setext headings, headings inside fences ignored); concurrent-modification test with two
  readers.
- integration: `reference add → index refresh → backlinks` shows the new link.

---

## M4 — Scopes

**Objective.** Operate across multiple vaults with explicit, honest resolution semantics and a
single owning vault for every write.

**Deliverables**

- domain: `Scope`, `ResolutionResult`, `resolveWriteTarget`, alias case rule.
- application: `loadScope` (named, explicit `--vault` paths, nearest), `resolveTarget`, federated
  `searchNotes` (rank-interleaved), federated `backlinks`, `diagnose` unavailable vaults; port
  `UserConfig`.
- infrastructure: `$XDG_CONFIG_HOME/notes/config.yaml` with named scopes (zod).
- CLI: `--scope`, `--vault` (repeatable), `scope list|show`; `create`/mutations require a
  resolvable write target.

**Dependencies.** M2 (M3 for write-target enforcement on mutations).

**Status.** Done 2026-10-27. Deviations: `create`/`adopt` choose the vault with `--in
<name|path>` rather than `--vault <name>`, because the global `--vault <path>` (repeatable)
already builds the scope and commander cannot carry both meanings; mutations need no selector
since the resolved source note names its vault. `doctor` treats an unavailable vault as an
error (exit 6). `index status|rebuild --json` now return `{ vaults: [...] }`.

**Acceptance criteria**

- `--scope work` with two vaults: `search` returns notes from both, interleaved, each tagged
  with its vault.
- Same id in two vaults ⇒ `show` exits `4` listing both.
- An alias present in both vaults ⇒ `reference add --target <alias>` exits `4`; by id it
  succeeds.
- A scope whose vault path is missing: reads of other vaults still work; a miss resolves as
  `Unavailable` (exit `7`), `scope show` and `doctor` name the missing vault.
- `create` in a composite scope without `--vault` exits `2` unless cwd is inside exactly one of
  its vaults.
- A reference across vaults resolves and appears in the target's backlinks within that scope.

**Tests**

- domain: scope invariants 3, 4, 7; interleave function.
- application: resolution matrix (id/alias × found/ambiguous/unavailable/not-found) with fakes.
- infrastructure: user config validation and missing-path handling.
- integration: two tmp vaults + a named scope, exercising the matrix through the CLI.

---

## M4.5 — Plugin core

**Objective.** The plugin contract from [plugins.md](./plugins.md) exists, is enforced by lint,
and carries one real plugin end to end through the CLI and `doctor`, so M5 can build the TUI on
the panel registry.

**Deliverables**

- application: `NotePlugin`, `FieldSpec`, `PluginCommand`, `PluginCheck`, `PanelSpec` and
  `PluginRegistry` types; `buildRegistry(plugins, scope)` (owner uniqueness, field-type
  conflicts, key collisions); `createPluginApi`; `setFields` mutation; declared-field
  validation shared by `doctor` and `show`.
- infrastructure: `plugins:` key in `.notes/config.yaml` (zod), settings handed to the plugin's
  own validator.
- plugins: `src/plugins/index.ts` and `src/plugins/todos/` (type `todo`; `status`, `due`,
  `priority`; `todos list`, `todos done`; one check; two panels, data only).
- CLI: plugin command groups generated from `PluginCommand`; `capabilities --json` lists
  plugins; `show` prints declared fields.
- tooling: ESLint rules for `src/plugins/**` and the layer-boundary test cases.

**Dependencies.** M3, M4.

**Acceptance criteria**

- A vault without `plugins:` behaves exactly as before; `notes todos` is then an unknown command
  (exit 2).
- With `plugins: { todos: {} }`: `create --template todos/task --title X` writes a `todo` note;
  `todos list --due today --json` returns it; `todos done <id>` sets `status: done` through the
  mutation path (`--dry-run` shows the diff; concurrent edit exits 5).
- A todo with `status: later` makes `doctor` emit a `field` warning naming the allowed values;
  `doctor` still exits 0.
- Two plugins declaring `status` with different types fail vault open with exit 6.
- `src/plugins/todos/` importing `commander`, `ink` or `node:fs` fails lint and the boundary test.

**Tests**

- application: registry conflicts; `setFields` (set, remove, dry-run, conflict);
  declared-field validation matrix.
- plugins: `todos` queries and commands against `test/fakes`.
- integration: the acceptance flow above through the CLI.

**Status.** Done 2026-10-27. Deviations: the application-side modules live under
`src/application/plugin/` (singular) because the lint rule that forbids importing `plugins`
from the core is a path pattern and would otherwise match the core's own directory; a plugin's
API scope is the sub-scope of members that enable it (unavailable members included), so reads
and writes never touch a vault that did not opt in; `capabilities` exists now in a first form
(commands from commander, exit codes, plugins with enablement) rather than waiting for M9;
every command builds the registry after loading the scope, so a broken `plugins:` key fails any
command with exit 6; plugin command groups are registered statically and answer "not enabled"
(exit 2) at run time, so `--help` lists `todos` even where it is off. The field-type conflict
case is covered by registry unit tests, since only one first-party plugin exists.

---

## M5 — TUI core

**Objective.** Browse, search, read, navigate and edit notes in the terminal using the same
services as the CLI.

**Deliverables**

- Spike (first task): Ink ↔ nvim handoff; recorded in `docs/decisions/0002-editor-handoff.md`.
- infrastructure: `render(parsed) → RenderedLine[]` with source spans; `ExternalEditor`;
  `FileWatcher`.
- TUI: app shell with screen stack built on the panel registry (plugins.md §4): core panels
  (`core.metadata`, `core.backlinks`, `core.calendar`) registered like plugin panels; `NoteList`
  (browse, `/` search, tag filter), `NoteView` (scroll, reference cursor, follow, back, side
  panels, `e` edit), `Calendar` (month grid, bound days, open day); `todos` panels rendered
  from their `PanelData` as proof; watcher-driven refresh; `●` modified marker placeholder
  until M7.
- CLI: `notes` with no subcommand launches the TUI; `notes edit` uses the same `ExternalEditor`.

**Dependencies.** M3, M4, M4.5.

**Acceptance criteria**

- Opening a note, following a reference, and pressing back returns to the same scroll position.
- A plugin panel with a key clashing with a core key fails at startup naming both; a `todos`
  home panel opens with its key and `Enter` on a row opens that note.
- A reference whose target is `NotFound` / `Ambiguous` / `Unavailable` is rendered with a
  distinct marker and `Enter` shows the reason instead of navigating.
- Pressing `e`, editing in nvim, and quitting returns to the TUI with the note re-rendered and
  the terminal in a sane state (raw mode restored, no leftover output).
- Modifying a note file externally while the TUI is open updates the list and the open view
  within one watcher tick.
- Calendar highlights days from `dates:` only, not file mtimes. A cell is the day number plus
  one marker: `·` for one bound note, a superscript count (`²`…`⁹`, `⁺` past nine) for more;
  today is painted in the accent colour, weekends dim. The year view is a strip of twelve
  month rows by 31 day columns (a dim `·` per day, the count where notes are bound), which
  fits an 80×24 terminal where twelve mini grids would not. Binding from the TUI (`b`, `x`,
  `Space d` in the note view) runs `bindDate`, the same service as `notes bind`.
- The TUI never reads SQLite or the filesystem directly; all data flows through application
  services (enforced by lint).

**Tests**

- infrastructure: render-map fixtures — every non-synthetic span maps to a source range whose
  text equals the span text (property over fixtures); wrapping preserves mapping.
- TUI (`ink-testing-library`): key maps per screen, screen stack push/pop, panels toggle,
  unresolved reference markers.
- Manual checklist for the editor handoff (documented in the decision record) plus an
  automated test that raw mode is restored after a fake editor exits.

**Status.** Done 2026-10-27. The spike found that Ink 8 ships the handoff as
`useApp().suspendTerminal` (decision 0002), so no hand-rolled raw-mode dance was needed; the
TUI runs on the alternate screen. Deviations: `render` is a method of the existing
`MarkdownParser` port rather than a new one, wrapped by `renderNote` in the application layer so
the TUI never calls a port directly; `ExternalEditor` and `FileWatcher` are ports outside
`AppDeps` (no use case needs them) and are created by `createInterfaceDeps()`; the watcher
only bumps a revision, the next read's incremental refresh does the indexing; `core.calendar`
is registered as a home panel (so its `c` key is collision-checked) but rendered by the
dedicated Calendar screen; screen-bound keys are checked against plugin panels at startup in
addition to the registry's panel-key check; the `list` placement is not rendered; `Esc` doubles
as back; unidentified files open by vault and path (`NoteLocator`). TUI tests drive the real
Ink runtime through injected streams (`test/tui/harness.tsx`) instead of `ink-testing-library`,
which cannot set the terminal size or observe raw mode. The `n` new-note prompt creates from the
`default` template in the scope's single or cwd-containing vault.

---

## M6 — TUI references

**Objective.** Create references and external links without leaving the viewer.

**Deliverables**

- TUI: `Picker` overlay (scope-wide search, title + vault, interleaved), location prompt
  (end / heading list / references), selection mode (`v`, motions/arrows, `r`, `l`, `Esc`),
  URL prompt for external links.
- application: wiring of `wrapSelectionAsReference` / `wrapSelectionAsExternalLink` with
  rendered→source mapping and the single-text-node rule.

**Dependencies.** M5.

**Status.** Done 2026-10-27. Deviations: the viewer has no resting cursor, so `v` starts the
selection on the first text of the top visible line and a second `v` restarts it at the head
(anchor and head are both inclusive); `l` is the link action, so moving right is the arrow
only (motions: `h`, `j`, `k`, arrows, `w`, `0`/`$`). `r` and `l` run `checkSelection`
(the wrap rules without a write) before asking for a target or URL, so "crosses formatting" is
shown at once; the mutations take an `expectedVersion` (the version the selection or picker
started on) and answer `CONFLICT` when the file moved, and the viewer also drops a selection
whenever a reload brings another version. The picker lists every identified note of the scope
when nothing is typed and otherwise searches with each typed word as a prefix (`pip*`); the
location prompt offers end, every heading, and the references section. Unidentified files
refuse `i`/`v` with a message. The integration parity check runs the TUI in-process against
the real adapters (`test/integration/tui-cli.test.tsx`), as the picker needs a terminal.
Follow-up (same day): the viewer gained a persistent vim-style cursor, so `v` starts at the
cursor, `Enter` follows the reference under it, `Tab` moves it between references, and `i`/`a`
insert a reference before the character / after the word under it through a new inline
`InsertionLocation` (`{ kind: 'at', offset, side }`, single-text-node rule, spaced like a
word); the location prompt moved to `I`.

**Acceptance criteria**

- `i` → pick a note from another vault → choose "under heading" → the file gains exactly one
  `[[id]]` at the right offset; the view reloads with the title rendered.
- Selecting `asynchronous ingestion pipeline` and pressing `r` → picking a target yields
  `[[ID|asynchronous ingestion pipeline]]` with surrounding text untouched.
- A selection crossing `*emphasis*` or a code span is drawn but `r`/`l` show "selection crosses
  formatting" and change nothing.
- `l` with a URL produces `[label](url)`; the URL is never indexed as a reference.
- If the file changed on disk during selection, the action exits with a conflict message and
  the selection is cleared.

**Tests**

- application: selection → edit computation on fixtures (plain, wrapped lines, unicode, emoji
  width); invalid selections rejected.
- TUI: picker filtering, location prompt choices, selection key flow with a fake store asserting
  the resulting source.
- integration: the same transformation via `reference add --label` and via the TUI path produce
  identical files.

---

## M7 — History and save

**Objective.** Read a note's revisions and record new ones explicitly, without Git concepts
leaking past the adapter.

**Deliverables**

- domain: `Revision`, `RevisionStatus`.
- application: `listRevisions`, `readRevision`, `diffRevisions`, `revisionStatus`, `saveNote`;
  port `RevisionProvider`.
- infrastructure: `simple-git` adapter — `list` follows renames, `read` at revision, `diff`
  (revision→revision, revision→working), `status`, `record` via
  `git add -- <path> && git commit -m <msg> -- <path>`; `NotUnderVersionControl` when no repo.
- CLI: `history`, `diff`, `show --at`, `save`.
- TUI: `History` screen, `●` modified marker, `s` save with message prompt.

**Dependencies.** M2 (TUI parts: M5).

**Status.** Done 2026-10-27. Deviations: the adapter runs the user's `git` binary through
`execFile` instead of `simple-git`, since every call needed raw output anyway (`log --follow
--name-status` for the path at each revision, pathspec-limited commits, hook output) and it keeps
the dependency list and the Bun compile target simple; pathspecs are passed as `:(literal)` so
glob characters in file names are taken literally. `diff` is not a provider operation: both
sides are read through `read` and compared with the domain's `unifiedDiff`, so the CLI's
`--dry-run` previews and `diff` look the same. `RevisionStatus` is `unversioned` (no repository)
| `unrecorded` (none yet) | `clean` | `modified`; `save` turns the first two non-recordable
cases into outcomes (`not-under-version-control`, `nothing-to-save`, exit 0, `status` in
`--json`) and a failing hook into `INTERNAL` (exit 1) carrying the hook's output. History use
cases take the viewer's `NoteLocator`, so unidentified files have a history too; `show --at`
parses the historical content with the normal loader and never indexes it. Revisions may be
given by full id or a unique prefix of at least four characters. The `●` marker also shows for
a versioned file with no revision yet. Known limit: a save after a plain `mv` records the new
path as a new file and leaves the old path's deletion to the user, so git's rename detection
cannot pair them; renames done with `git mv` and committed are followed.
Follow-ups from use (same day): `b` is "back" on every screen (with `Esc` and `Backspace`),
replacing `u`; the backlinks panel moved to `B` and the cursor lost its word-back motion (`w`
remains). `create` writes `created: <ISO instant>` into the frontmatter unless the template
sets it; `created` is a recognized key (shown by `show` and the metadata panel, excluded from
plugin fields) and is not a date binding. So that new notes still appear in the calendar, the
built-in `default` template binds them to their creation day (`dates: ["{{date}}"]`); a vault's
own `default.md` and other templates decide for themselves. The TUI's `n` asks for a template
after the title, every time (the vault's own plus the enabled plugins' built-ins, `default`
first); with only `default` the picker shows that one row, so the step reads the same whatever
the vault offers and a vault's own `default.md` is visibly the one in use. Each row shows the
path that template would write for the typed title (`previewTemplates`, sharing `createNote`'s
path logic; an `{{id}}` in a path stays as a placeholder since no id is generated for a
preview, and an unusable template says why in place of a path).
`notes init` takes `--dir <notes-dir>` (the single `include` glob `<dir>/**/*.md`, created with
the vault, where `create` writes by default) and asks for it when run at a terminal without the
flag; `--json`, pipes and scripts are never asked and keep the whole vault as before.
A template's `template.path` now resolves inside that notes directory (a leading `/` anchors it
at the vault root), so a vault with `include: notes/**/*.md` and a template writing
`decisions/{{date}}-{{slug}}.md` lands at `notes/decisions/...` rather than at an unindexed
`decisions/...`. Whatever chooses the path, `create` refuses with exit 6 any file the vault's
`include`/`exclude` globs would not index, naming the path and the globs; the domain gained a
small glob matcher (`matchesGlob`, `inclusionOf`) for that, since neither the domain nor the
application may import the indexer's glob library.

**Acceptance criteria**

- In a repo with unrelated staged changes, `save <id>` commits only the note's path; the other
  staged changes remain staged.
- `save` on an unchanged note returns `NothingToSave` (exit `0`, message); in a non-Git vault
  returns `NotUnderVersionControl` (exit `0` with `--json` status, clear message).
- A failing pre-commit hook surfaces its output and exits `1` with nothing committed.
- `history` lists revisions across a file rename.
- `diff` with no arguments shows last revision → working file.
- `show --at <rev>` renders historical content without touching the index.

**Tests**

- application: save/status/history against a fake provider including hook rejection.
- infrastructure: real tmp git repo — rename tracking, pathspec commit isolation, hook failure,
  non-repo directory, vault nested below repo root.
- TUI: history screen keys; save prompt flow.

---

## M7.5 — Workspace: columns, a leader key, and a visual pass

**Objective.** The TUI shows more than one panel at once in an arrangement the user chooses,
every global action is reachable and discoverable through a leader key, and the screens look
deliberate. Decided in
[decision 0003](./decisions/0003-workspace-layout-and-leader-key.md); scheduled before M8
because it changes what plugins register.

**Deliverables**

- Visual pass (first, independent of the layout): `src/interfaces/tui/theme.ts` with named
  roles (accent, muted, selection, link, ok, error) honouring `NO_COLOR`; hints rendered as
  accent key + dim label; header with title left and scope/count right; `Rows` with per-column
  roles and a `▸` cursor marker instead of full inverse; prompts and pickers as rounded bordered
  overlays.
- domain/application: `Layout` (columns of `{ width, panels }` with `1fr`/cells), a pure
  `arrange(layout, columns, rows, minimums)` that yields column rectangles and the collapse
  order; `UserConfig.tui` (leader, layout, layouts) validated in the user-config adapter, with
  the built-in `focus` layout as fallback.
- TUI: `Workspace` renders the arranged columns, each panel through `PanelView` with its own
  cursor; `main` hosts the screen stack; a single focused panel; the leader with a which-key
  popup; chords for focus, column toggles, the layout picker, and every panel jump; plugin
  `chord` replaces `key` in `PanelSpec`, with prefix/equality collision checks in the registry.
- CLI: `capabilities --json` lists chords instead of keys.

**Dependencies.** M6 (M7 for the history panel).

**Acceptance criteria**

- With the `review` layout from the decision record on a 120×40 terminal, the note and its
  backlinks render side by side; `Space l` moves focus to the backlinks, `Enter` there opens
  the row's note in `main`; `Space t 2` hides the column and `main` takes the full width.
- On an 80-column terminal the same layout shows only `main`; every key of M5–M7 behaves as
  before, and `Space c` opens the calendar as a screen.
- A plugin declaring the chord `T` while another declares `T x` fails registry build with a
  message naming both panels.
- `Space` inside the title prompt types a space; `Esc` after a lone `Space` cancels the chord
  and leaves the screen unchanged.
- An invalid `layouts:` entry falls back to `focus` and says so in the status line.
- Colours are absent with `NO_COLOR=1` and the same text is rendered.

**Tests**

- domain: `arrange` matrix (fractions, fixed cells, minimums, collapse order, one column).
- infrastructure: `tui:` parsing and its error messages.
- TUI (harness): focus movement, toggles, which-key popup, chord cancellation, leader ignored
  in prompts, panel jump falling back to a screen in a one-column layout.
- registry: chord collisions.

**Status.** Visual pass done 2026-10-27 (workspace and leader pending). `theme.ts` maps roles
(accent, muted, ok, error, warn, link, unavailable, tag, heading, code) to colours and paints
nothing under `NO_COLOR`; the runner builds it from the process environment and tests from
`{}`. `Frame` takes `meta` (right-aligned, the list's note count), structured hints
(`[key, label]` pairs, key in accent, label dim, an optional `mode:` prefix for `select` and
`panel`), and paints status lines by level. `Rows` marks the cursor row with `▸` in bold
accent instead of inverse video, indents the other rows to keep columns aligned, and paints
columns by role (ids, vaults and dates muted, tags magenta). `Dialog` is a rounded bordered
box used by the title/search/tag prompts, the template picker, the reference picker, the
location prompt and the url/save prompts; a dialog costs two rows of chrome, which the rows
under it give up. Reference, heading and code colours in the note body and the diff colours go
through the theme. Deviation: the plan's "subtle background" for the cursor row was dropped in
favour of marker plus bold accent, which reads on light and dark terminals alike.

Keys and leader done 2026-10-27 (same day, from use: "we must make the select mode a first-class
citizen", "standard vim motions"). The note view and select mode share one motion table:
`h/j/k/l`, `w/b/e` (vim's small words: punctuation runs are words of their own), `0/^/$`,
`{/}` paragraphs, `gg/G`, `Ctrl-d/u/f/b`, arrows and page keys; `Space` no longer pages (it is
the leader). Consequences of `b` and `e` becoming motions: back is `Ctrl-o` (vim's jump back),
`Backspace` or `Esc` on every screen, and `b` is never "back" anywhere; the editor opens with
`o`; the external link in select mode is `u` (url). On the list `c` creates a note (`n` is
kept free for search-next later) since the calendar jump moved under the leader. The leader
(`chords.tsx`, `useLeader`) is per screen: `Space` opens a which-key `Dialog` listing the
screen's chords, the next key runs one, `Esc` cancels, an unbound key reports in the status
line, and modal flows (prompts, pickers, selection) keep `Space` as a space by passing
`active: false`. Chords today: home panel jumps (`c`, `T`), note panel toggles (`m`, `B`,
plugin chords), `b` back on pushed screens, `q` quit. `PanelSpec.key` became `chord`;
`RESERVED_CHORDS` (`b`, `q`) replaced `RESERVED_KEYS`, and `capabilities --json` reports
`chord`. Also from use: references can be removed in the note view with `x` on the reference
under the cursor (`removeReference`, a `mutateNote` with `referenceDelta: -1`; a labelled
reference becomes its label text, a bare one goes with one adjacent space, or with its whole
line when it stood alone in a `## References` list). The history screen previews the selected
revision beside the list on terminals of 100 columns or more (`d` flips the pane between the
revision's content and its diff against the working file, `Ctrl-d/u` scroll it, `Enter` still
opens the full screen); narrower terminals keep the list alone with the pushed screens. The
note view marks unsaved changes line by line: in a versioned vault a two-cell gutter shows `▎`
on lines added or rewritten since the last saved revision and `▁` where lines were deleted
(`changedLines` in the domain aligns the saved and working sources; rendered lines map back
through their first source span). `save` records every revision as `note: <message>` (default
`note: save <title>`, a message already carrying the scope is left alone), so note commits read
as their own kind in a repository that also holds other work. Still open from this milestone: the
column workspace, `UserConfig.tui`, focus moves and
layout chords, multi-key chords with the prefix rule.

Calendar reworked 2026-10-27 (from use: "it could benefit from a better ui/ux"). The weekday
header and the cells share one four-cell rhythm (they were misaligned); today is marked; a
cell's marker counts the bound notes (`·`, `²`…`⁹`, `⁺`); weekends are dim. On 90+ columns the
notes of the cursor day list beside the grid (`Enter`/`Tab` focus the list, `Enter` opens,
`Tab`/`h` return); narrower terminals keep the day screen. Jumps: `t` today, `g` prompts for
`YYYY-MM-DD` or `YYYY-MM` (`parseDateJump`), `{`/`}` a year. Binding reached the TUI: `b`
picks a note and binds it to the cursor day, `x` unbinds the listed note (calendar list and
day screen), and `Space d` in the note view binds the open note to a typed date; all through
`bindDate`, reported in the status line (`Bound <title> to <date>`). The same day the views
followed ("I would add the missing calendar views"): one `calendar` screen with
`view: month | week | year | agenda` on one cursor date, switched by `m/w/y/a` and shown as
tabs in the header; `d` pushes the day screen, now richer (tags, the first two body lines,
`h/l` walk the days). Week: seven columns of titles; year: the month-by-day strip; agenda:
the month's bindings as rows (`Enter` opens, `x` unbinds), the cursor landing on the cursor
date. All views load `boundDates` for their range, so the month's side list needs no second
query.

---

## M8 — Export

**Objective.** Publish selected notes to Markdown or HTML fragments with transformed references
and fail-safe boundaries.

**Deliverables**

- domain: `Publication`, route template, reference classification, collision detection,
  reference policy.
- application: `planPublication` (pure), `executePublication`.
- infrastructure: remark→rehype HTML fragment writer, Markdown writer with relative links,
  `manifest.json`.
- CLI: `export --publication <name>` / `--format --output`, `--dry-run` prints the plan.

**Dependencies.** M4.

**Acceptance criteria**

- A note without `visibility: public` is excluded unless an explicit publication include
  matches it; `--dry-run` lists it as excluded with the reason.
- A reference to an excluded note with policy `fail` aborts with exit `6` and names source and
  target; with `strip-to-label` emits the label text; with `keep-id` emits `[[id]]` verbatim.
- Two notes resolving to the same route abort before any file is written.
- Markdown output turns `[[ID|Label]]` into `[Label](./relative/path.md)`; HTML output into
  `<a href="/route/">Label</a>`; unlabeled references use the current title.
- `manifest.json` lists every published note with `id, title, route, path, dates, tags`.
- Source file hashes are identical before and after export.

**Tests**

- domain: selection and policy matrix; route template rendering; collision detection.
- application: plan against a fixture scope with mixed visibility and cross-vault references.
- infrastructure: golden-file tests for Markdown and HTML outputs.
- integration: `init → create (public/private) → reference → export → assert links and
manifest`.

---

## M9 — Hardening

**Objective.** The CLI contract is complete, documented and verified end to end for agents.

**Deliverables**

- `capabilities --json` describing commands, flags, exit codes and JSON shapes (generated from
  the commander definitions, not hand-written).
- Exit-code and `--json` audit across every command; `--no-interactive` guarantees no prompt.
- Full integration suite running the specified scenarios: initialize a vault, create notes, link
  notes, search and navigate references, export content, verify generated links.
- README: install, quick start, scope configuration, agent usage with `--json`.
- Single-file executables that need no Node: `bun run compile:all` builds
  `release/notes-{linux,darwin}-{x64,arm64}`; `test/binary/compiled.test.ts` runs the host's
  binary with Node off `PATH` (version, init/create/list/search, save to git, TUI refusal
  without a terminal) and is skipped when no binary has been built.

**Dependencies.** All.

**Acceptance criteria**

- Every error path in the integration suite produces the documented exit code and a JSON error
  object under `--json`.
- Every command appears in `capabilities --json` with the same flags commander accepts (test
  compares the two).
- `bun run check` green; no `TODO` left in `src/`.

**Tests.** Integration suite; capabilities/commander consistency test; compiled-binary smoke test.

**Status (2026-10-27).** The executables landed early, ahead of the rest of M9: `scripts/compile.ts`
builds all four targets with `Bun.build` (Bun 1.4.4 pinned in `mise.toml`), the version comes from
`src/interfaces/cli/version.ts` rather than a `package.json` read, and Bun replaced npm as the
package manager (`bun.lock`). A first `README.md` covers install, quick start, `--json` use and
scopes. The other M9 items are not started.
