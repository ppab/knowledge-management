# Implementation Plan — v0.1

Companion to [architecture.md](./architecture.md). Each milestone is a vertical slice that is
independently testable and leaves `main` working. Definition of done applies to every milestone:

- All listed tests pass under `npm test`; lint, format and `tsc --noEmit` are clean.
- No layer-boundary violations (ESLint).
- No placeholder code; every exported symbol has a caller or a test.
- `notes capabilities --json` reflects the commands that exist.

```
M0 ─ M1 ─ M2 ─┬─ M3 ─┐
              ├─ M4 ─┼─ M5 ─ M6 ─┐
              ├─ M7 ──────────────┼─ M9
              └─ M8 ─ ────────────┘
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
  per layer), Prettier, `npm run check` (lint + format + typecheck + test).
- `src/{domain,application,infrastructure,interfaces}` with a smoke module in each to exercise
  the boundary rules.
- Spike result recorded in `docs/decisions/0001-sqlite.md`: does `node:sqlite` on the target
  Node version ship FTS5? If not, switch to `better-sqlite3` here.
- `notes --version` runs.

**Dependencies.** None.

**Acceptance criteria**

- Importing `infrastructure` from `domain`, or `interfaces` from `application`, fails lint.
- `node -e "new (require('node:sqlite').DatabaseSync)(':memory:').exec('CREATE VIRTUAL TABLE t USING fts5(x)')"` succeeds (or the fallback decision is documented).
- `npm run check` is green on a clean clone.

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

**Dependencies.** M1.

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

## M5 — TUI core

**Objective.** Browse, search, read, navigate and edit notes in the terminal using the same
services as the CLI.

**Deliverables**

- Spike (first task): Ink ↔ nvim handoff; recorded in `docs/decisions/0002-editor-handoff.md`.
- infrastructure: `render(parsed) → RenderedLine[]` with source spans; `ExternalEditor`;
  `FileWatcher`.
- TUI: app shell with screen stack; `NoteList` (browse, `/` search, tag filter), `NoteView`
  (scroll, reference cursor, follow, back, metadata and backlinks panels, `e` edit), `Calendar`
  (month grid, bound days, open day); watcher-driven refresh; `●` modified marker placeholder
  until M7.
- CLI: `notes` with no subcommand launches the TUI; `notes edit` uses the same `ExternalEditor`.

**Dependencies.** M3, M4.

**Acceptance criteria**

- Opening a note, following a reference, and pressing back returns to the same scroll position.
- A reference whose target is `NotFound` / `Ambiguous` / `Unavailable` is rendered with a
  distinct marker and `Enter` shows the reason instead of navigating.
- Pressing `e`, editing in nvim, and quitting returns to the TUI with the note re-rendered and
  the terminal in a sane state (raw mode restored, no leftover output).
- Modifying a note file externally while the TUI is open updates the list and the open view
  within one watcher tick.
- Calendar highlights days from `dates:` only, not file mtimes.
- The TUI never reads SQLite or the filesystem directly; all data flows through application
  services (enforced by lint).

**Tests**

- infrastructure: render-map fixtures — every non-synthetic span maps to a source range whose
  text equals the span text (property over fixtures); wrapping preserves mapping.
- TUI (`ink-testing-library`): key maps per screen, screen stack push/pop, panels toggle,
  unresolved reference markers.
- Manual checklist for the editor handoff (documented in the decision record) plus an
  automated test that raw mode is restored after a fake editor exits.

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

**Dependencies.** All.

**Acceptance criteria**

- Every error path in the integration suite produces the documented exit code and a JSON error
  object under `--json`.
- Every command appears in `capabilities --json` with the same flags commander accepts (test
  compares the two).
- `npm run check` green; no `TODO` left in `src/`.

**Tests.** Integration suite; capabilities/commander consistency test.
