# Architecture — Local-First Knowledge Management Framework

Status: approved design for v0.1 (2026-10-27). Companion: [plan.md](./plan.md).

## 1. Overview

Single TypeScript/ESM package. Four layers; dependencies point inward only, enforced by ESLint
import restrictions.

```
interfaces/      cli (commander)            tui (Ink + React)
                     │                            │
                     └────────────┬───────────────┘
application/     use cases + ports (what the app needs from the outside world)
                                  │
domain/          pure entities, value objects, invariants — no runtime dependencies
                                  ▲
infrastructure/  filesystem · markdown (remark) · yaml · sqlite (node:sqlite) · git (the git binary)
                 · identity · editor · config · watcher
```

Properties:

- **Markdown files are the only authoritative store.** SQLite under `.notes/cache/` is a
  disposable projection, rebuildable from the files. `.notes/cache/.gitignore` contains `*`, so
  the cache never enters Git and the project's own `.gitignore` is never modified.
- **Mutations are source-offset splices, never AST re-serialization.** Parse with remark for
  positions, compute `TextEdit {start, end, replacement}`, splice the original string. Bytes
  outside the edited ranges are untouched. Frontmatter edits go through the `yaml` Document API
  (preserves key order, comments, unknown fields).
- **Optimistic concurrency.** Reads return a `version` (content hash). Writes carry
  `expectedVersion`; the store re-reads, compares, and refuses with `Conflict` on mismatch.
  Writes are atomic (temp file + rename). No locks, no daemon.
- **Composite scopes federate.** Each vault owns its index; composite queries fan out and merge
  in the application layer. No global database.
- **CLI and TUI are thin.** Both call the same `application/` services. The TUI adds only a
  screen stack, a rendered↔source map for selection, and a file watcher.
- **Revisions are explicit.** Nothing auto-commits. `save` records a revision of exactly one note.

Source tree:

```
src/
├── domain/         vault · scope · note · identity · reference · calendar · revision
│                   · publishing · text-edit
├── application/    vault · notes · references · search · calendar · history · templates
│                   · export · index · doctor · ports.ts
├── infrastructure/ filesystem · markdown · yaml · sqlite · git · identity · editor · config
│                   · watcher
└── interfaces/     cli · tui
test/
├── fakes/          in-memory implementations of every port
├── fixtures/       representative vaults and Markdown files
└── integration/    spawns the real CLI binary against tmp vaults
```

Libraries:

| Concern      | Choice                                                                       | Why                                               |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Markdown AST | `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-stringify` | positional info on every node; standard           |
| Frontmatter  | `yaml` (`parseDocument`)                                                     | round-trips comments and key order                |
| SQLite       | `node:sqlite` (Node ≥ 24); fallback `better-sqlite3`                         | no native build; FTS5 availability verified in M0 |
| Git          | the user's `git` binary via `execFile` (M7: no `simple-git`)                 | uses the user's git and config; follows renames   |
| CLI          | `commander`                                                                  | composable, explicit exit codes                   |
| TUI          | `ink`, `react`                                                               | as specified                                      |
| IDs          | `ulid`, `uuid` (v7)                                                          |                                                   |
| Globs/watch  | `tinyglobby`, `chokidar`                                                     |                                                   |
| Validation   | `zod`                                                                        | config, frontmatter, CLI JSON contracts           |
| Tests        | `vitest`, `ink-testing-library`                                              |                                                   |

## 2. Domain model

### Entities

| Entity                 | Identity                        | Fields                                                                                        |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `Vault`                | `VaultId` (ULID, set at `init`) | name, include/exclude globs, identity strategy. Root path is an infrastructure detail.        |
| `Note`                 | `NoteId`                        | title, aliases, dates, tags, visibility, references, opaque extra frontmatter, body           |
| `UnidentifiedNote`     | path (vault-relative)           | A Markdown file matched by `include` with no `id`. Listed and searchable; read-only.          |
| `Template` / `Snippet` | name                            | variables, content; template adds output path, snippet adds default insertion location        |
| `Publication`          | name                            | vault selection, include/exclude, visibility filter, route template, reference policy, format |

### Value objects

- `NoteId` — opaque validated string; equality by value; never rewritten.
- `Alias` — string; compared case-insensitively within a scope; never persisted into references.
- `Reference { target: NoteId, label?: string, range: SourceRange }` — from `[[ID]]` / `[[ID|Label]]`.
- `ResolutionResult` — `Resolved {note, vaultId}` | `NotFound` | `Unavailable {vaultIds}` | `Ambiguous {candidates}`.
- `DateBinding` — ISO date from frontmatter `dates:`; independent of file timestamps. Set semantics.
- `Scope` — `VaultScope(vaultId)` | `CompositeScope(vaultIds[])`, with per-vault availability.
- `Revision { id, timestamp, summary, author?, path }` — provider-neutral; `RevisionStatus` is
  `unversioned` | `unrecorded` | `clean {last}` | `modified {last}`.
- `TextEdit { start, end, replacement }`, `applyEdits(source, edits)` — the single mutation primitive.
- `InsertionLocation` — `AtEnd` | `UnderHeading(text)` | `InReferencesSection`.
- `DocumentVersion` — content hash for conflict detection.
- `Visibility` — `public` | `private`; absent ⇒ `private` for publishing.

### Invariants (tested in `domain/`)

1. A `NoteId` is assigned once and never rewritten by any operation (rename, move, strategy
   change, re-template).
2. Two documents with the same `NoteId` in one vault ⇒ `DuplicateIdentity`; never a silent pick.
3. Canonical-ID resolution with more than one match across a composite scope ⇒ `Ambiguous`.
4. Alias resolution with more than one candidate ⇒ `Ambiguous`.
5. A reference targets a `NoteId` only; an external URL never becomes a `Reference`.
6. Applying a `TextEdit` set changes nothing outside the edited ranges (property-tested).
7. A composite scope is read-only; `resolveWriteTarget(scope, vaultId?)` yields exactly one vault
   or fails.
8. Date bindings form a set.
9. A publication plan never contains a note whose visibility is not `public` unless an explicit
   publication include matches it.
10. Unidentified notes cannot be mutated or referenced until adopted.

## 3. Decisions (resolved 2026-10-27)

| #   | Question                        | Decision                                                                                                                                                                             |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `{type}` in formatted identity  | Taken from the template name (`templates/adr.md` ⇒ `ADR`); overridable by frontmatter `type`. A format referencing an unavailable variable fails config validation.                  |
| A2  | Files in `include` without `id` | Indexed as unidentified (listed, searchable, read-only). `doctor` reports them; `notes adopt <path>` assigns an id. Mutations and references require an id.                          |
| A3  | Missing `visibility`            | Treated as `private` for publishing (default-deny).                                                                                                                                  |
| A4  | Commits                         | Never implicit. `save` (TUI `s`, CLI `notes save <id>`) records a revision of exactly one note via `git add -- <path> && git commit -- <path>`.                                      |
| A5  | Working copy as revision        | `history` lists commits only; `diff` defaults to last revision → working file.                                                                                                       |
| A6  | `NotFound` vs `Unavailable`     | `Unavailable` when any vault in the scope could not be opened; otherwise `NotFound`.                                                                                                 |
| A7  | HTML export shape               | Body fragments + `manifest.json`. Layout belongs to the static site generator.                                                                                                       |
| A8  | `create` without template       | Built-in `default` template writing `{{slug}}.md` into the first `include` directory, bound to its creation day (`dates: ["{{date}}"]`); `.notes/templates/default.md` overrides it. |
| A9  | Notes per file                  | Exactly one.                                                                                                                                                                         |
| A10 | Federated FTS ranking           | BM25 scores are not comparable across indexes. Human views interleave by rank position across vaults; `--json` carries `vault` and `rankInVault`.                                    |
| A11 | Named scope with a moved vault  | Scopes reference paths; `doctor` and `scope show` flag missing vaults as unavailable. No registry.                                                                                   |
| A12 | Visual selection                | Restricted to a single mdast `text` node in v0.1.                                                                                                                                    |

## 4. Application layer

### Use cases

| Area       | Use cases                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vault      | `initVault`, `locateVault`, `loadScope` (named / explicit vault paths / nearest)                                                                            |
| notes      | `listNotes`, `showNote`, `createNote`, `editNote` (external editor), `adoptNote`, `saveNote`                                                                |
| references | `resolveTarget`, `addReference(source, target, location, label?)`, `wrapSelectionAsReference`, `wrapSelectionAsExternalLink`, `listReferences`, `backlinks` |
| search     | `searchNotes(query, scope)`, `lookupByTitleOrAlias`                                                                                                         |
| calendar   | `bindDate`, `unbindDate`, `notesOnDate`, `datesInRange`                                                                                                     |
| history    | `listRevisions`, `readRevision`, `diffRevisions`, `revisionStatus` (modified since last revision?)                                                          |
| templates  | `renderTemplate`, `insertSnippet`                                                                                                                           |
| export     | `planPublication` (pure) → `executePublication`                                                                                                             |
| index      | `rebuildIndex`, `refreshIndex(paths)`, `indexStatus`                                                                                                        |
| doctor     | `diagnose` → duplicate ids, unidentified notes, dangling references, stale index, unavailable vaults                                                        |

Use cases return typed results (`Result<T, DomainError>`); expected outcomes are values, not
exceptions.

### Ports (`application/ports.ts`)

| Port                 | Adapter    | Contract                                                                                                                                                                         |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VaultLocator`       | filesystem | `findNearest(cwd)`, `open(path)` → validated config                                                                                                                              |
| `NoteStore`          | filesystem | `list(globs)`, `read(path) → {source, version}`, `write(path, source, {expectedVersion?})` → `Ok                                                                                 | Conflict`, `exists(path)` |
| `MarkdownDocument`   | remark     | `parse(source) → ParsedNote {frontmatterRange, title, headings[], references[], textSpans[]}`; `locate(parsed, InsertionLocation) → offset`; `render → RenderedLine[]`; `toHtml` |
| `FrontmatterCodec`   | yaml       | `read(source)`, `set(source, key, value) → TextEdit` preserving everything else                                                                                                  |
| `NoteIndex`          | sqlite     | `upsert`, `remove`, `clear`, `findById`, `findByAlias`, `findByTitle`, `search`, `byDate`, `outgoing`, `backlinks`, `stats`                                                      |
| `IdentityStrategy`   | identity   | `generate(ctx) → NoteId` for `ulid` / `uuidv7` / `formatted`                                                                                                                     |
| `RevisionProvider`   | git        | `status`, `list` (follows renames), `read(revision)`, `record(path, message)`; an unversioned vault is a status, not an error; diffs are computed in the domain (`unifiedDiff`)  |
| `TemplateRepository` | filesystem | `getTemplate`, `getSnippet`, `list`                                                                                                                                              |
| `ExternalEditor`     | editor     | `open(file, {command?})` — vault `editor:` → `$VISUAL` → `$EDITOR` → `nvim`; CLI spawns directly, TUI suspends Ink first                                                         |
| `FileWatcher`        | chokidar   | TUI-only; `watch(roots, onChange)` batches `.md` changes per tick, ignores dot directories; the next read refreshes the index                                                    |
| `UserConfig`         | config     | named scopes in `$XDG_CONFIG_HOME/notes/config.yaml`                                                                                                                             |
| `Clock`              |            |                                                                                                                                                                                  |

### Persistence contracts

**Vault config** `.notes/config.yaml` (zod-validated):

```yaml
vault:
  id: 01K...
  name: monitor
notes:
  include: ['docs/**/*.md']
  exclude: ['node_modules/**', '.git/**']
identity:
  strategy: ulid | uuidv7 | formatted
  format: '{vault}-{type}-{date}-{ulid}' # formatted only
editor: nvim # optional; else $VISUAL / $EDITOR
plugins: # optional, see §9; a bare key enables a plugin with default settings
  todos:
publications: # optional, see §7
  site:
    format: html
    output: ./dist
    route: '/{slug}/'
    include: ['docs/**']
    unresolved: fail
```

**Frontmatter** — recognized keys: `id`, `title`, `created`, `aliases`, `dates`, `tags`, `visibility`, `type`,
`slug`. Everything else is preserved opaquely. Title fallback: `title` → first H1 → filename stem.

**Index schema** (`.notes/cache/index.sqlite`, keyed by `path` so duplicate ids stay
representable): `notes(path, id, title, visibility, type, slug, version, mtime, size,
unidentified, aliases, dates, tags, fields, issues)`, lookup tables `aliases(path, alias)`,
`dates(path, date)`, `tags(path, tag)`, `fields(path, key, value, kind)` (every frontmatter key
the core does not interpret, one row per scalar; this is what plugins query by),
`refs(path, target, label, start, end)`, `notes_fts` (FTS5 over title, aliases, body; bm25
weights 10/5/1) and `meta(schema_version)`. A schema version mismatch resets the index.

**Freshness.** Every read use case opens the index, runs an incremental refresh and then
queries. A file whose `mtime` and `size` match the index is skipped; any other file is re-read
and compared by content hash, so a `touch` never re-indexes and an edit that keeps the size is
still caught. Files no longer matched by the vault's globs are dropped. `index status` reports
what a refresh would change without changing anything; `doctor` reports whether the index was
stale, then refreshes it before running its checks.

### Reference parsing and resolution

- References are extracted from mdast `text` nodes only, so `[[…]]` inside code spans, fenced
  blocks and URLs is never a reference.
- Grammar: `[[ID]]` | `[[ID|Label]]`; ID contains no whitespace, `|` or `]`.
- Every reference carries its exact source range.
- `resolveTarget(input, scope)`: if `input` matches an id in any available vault → id path; else
  alias/title path (case-insensitive). Multiple matches ⇒ `Ambiguous`. Zero matches with an
  unavailable vault in scope ⇒ `Unavailable`; otherwise `NotFound`.
- Display: without a label the target's current title is shown; with a label the label is shown.
  The source file is never rewritten for display.

### Safe mutation strategy

Every mutation: read (version) → parse → compute `TextEdit[]` → apply → re-parse and assert
(frontmatter unchanged unless intended; reference count delta as expected; heading set unchanged)
→ `write(expectedVersion)` → `refreshIndex([path])`. `--dry-run` stops after the assert and
prints a unified diff.

Insertion locations: `AtEnd` appends after trailing content with a blank line; `UnderHeading`
inserts before the next heading of equal or higher depth; `InReferencesSection` finds a heading
whose text is `References` (case-insensitive) or creates one at the end.

### TUI rendered↔source map

`render(source, bodyStart, {width, referenceText}) → RenderedLine[]`, each line a list of
`Span {text, source?, reference?, style?}`. A span with `source` shows exactly that slice of the
source (escapes and entities as written), so the map is trivially exact; bullets, heading
markers, quote bars and reference labels are synthetic. Code, tables and raw HTML are shown
verbatim line by line, still mapped. Wrapping is greedy by words (a reference label is one
token) and continuation lines indent under their bullet.
Selection lives in rendered coordinates and is valid only when anchor and head both map to
source inside the same mdast `text` node. Invalid selections are drawn but `r`/`l` refuse with a
message. This guarantees we never split emphasis, links or code spans.

## 5. CLI

```
notes init [--name <n>] [--dir <notes-dir>] [--identity ulid|uuidv7|formatted --format "..."]   # --dir asked for when interactive
notes list [--tag <t>] [--date <d>|<from>..<to>] [--vault <name>] [--unidentified]
notes show <id|alias> [--raw] [--at <rev>]
notes search <words...> [--limit <n>]        # trailing * on a word matches prefixes
notes create --template <name> --title <t> [--var k=v]... [--in <vault>]   # --in: name or path within the scope
notes edit <id>
notes adopt <path>... [--type <type>] [--in <vault>]
notes save <id> [-m <message>]
notes bind <id> --date <d> [--remove]
notes reference add --source <id> --target <id|alias> [--at end|heading:<text>|references] [--label <l>]
notes reference list <id>
notes backlinks <id>
notes snippet insert <id> --snippet <name> [--at ...] [--var k=v]...
notes history <id>
notes diff <id> [--from <rev>] [--to <rev>|working]
notes export (--publication <name> | --format md|html --output <dir>) [--dry-run]
notes index rebuild | status
notes doctor [--fix]
notes scope list | show [<name>]
notes capabilities --json

Global: --scope <name> | --vault <path> (repeatable)  (default: nearest vault from cwd)
        --json  --dry-run  --no-interactive  --cwd <dir>
```

Exit codes: `0` ok · `1` unexpected · `2` usage · `3` not found · `4` ambiguous · `5` conflict ·
`6` validation · `7` vault unavailable. With `--json`, errors are
`{ "error": { "code", "message", "details" } }` on stdout; nothing ever prompts.

## 6. TUI

Screen stack (`push`/`pop`); each screen owns its key map.

| Screen     | Keys                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoteList` | `j/k` move · `/` search · `t` tag filter · `c` calendar · `Enter` open · `n` new note (title, then a template when the vault offers more than one) · `q` quit                                                                                                                                                                               |
| `NoteView` | `h/j/k/l`, arrows, `w`, `0/$`, `g/G` move the cursor · `Tab` next reference · `Enter` follow the one under the cursor · `b`/`Backspace`/`Esc` back · `m` metadata · `B` backlinks · `e` edit (nvim) · `s` save revision · `i`/`a` reference before/after the word under the cursor · `I` reference at a location · `v` select · `H` history |
| selection  | `h/j/k`/arrows, `w`, `0/$` extend · `v` restart here · `r` reference (opens picker) · `l` external link (prompts URL) · `Esc` cancel                                                                                                                                                                                                        |
| `Calendar` | `h/j/k/l` move · `[`/`]` month · `Enter` notes on day · `Esc` back                                                                                                                                                                                                                                                                          |
| `Picker`   | type to search (scope-wide, interleaved by vault) · `Enter` select → location prompt (end / heading / references) · `Esc`                                                                                                                                                                                                                   |
| `History`  | `j/k` · `Enter` view at revision · `d` diff against working                                                                                                                                                                                                                                                                                 |

Header shows title, vault, id, and `●` when the file differs from its last revision (or has
none yet). The watcher refreshes the index on change; the open note reloads and a pending
selection is invalidated if its version went stale. `s` prompts for a message and records the
note (empty message: `Save <title>`); `H` opens the history, whose `Enter` shows the note at a
revision read-only and `d` shows a unified diff of that revision against the working file.

As built in M5: `Esc` also goes back on every pushed screen; `g`/`G` jump to the top and bottom;
home panels from the registry (`c` calendar, `T` todos, …) are listed in the `NoteList` hints and
open as screens. In `NoteView` a side panel (`m`, `b`, plugin keys) takes the keyboard while it
is open: `j/k` move its cursor, `Enter` opens the row's note, its action keys run, `Esc` closes
it; a plugin's keyless note panel shows automatically for notes of the types it owns. References
render as the label or the target's title, coloured by resolution and marked `[missing]`,
`[ambiguous]` or `[unavailable]`; `Enter` on one of those explains instead of navigating. The
TUI runs on the alternate screen and refuses to start without a TTY (exit 2). `notes edit <id>`
runs the same editor adapter from the CLI.

External editor from the TUI: Ink's `suspendTerminal` hands the terminal over, the editor runs
with `stdio: inherit`, and Ink repaints on return
([decision 0002](./decisions/0002-editor-handoff.md)).

As built in M6: the note screen keeps a text cursor (in its stack entry) that rests on the
first text of the note and moves with vim motions; the view scrolls to keep it on screen.
`i` and `a` open the picker (every identified note of the scope, narrowed by typing with each
word as a prefix) and insert `[[id]]` before the character or after the word under the cursor,
spaced so the reference reads as a word, through `addReference` with the `at` location, which
obeys the single-text-node rule like a selection. `I` asks for a location instead (end, each
heading, references section). `v` starts a selection at the cursor; anchor and head are
inclusive rendered positions, a second `v` restarts at the head, and only `r`, `l` and `Esc`
leave the mode, leaving the cursor at the head. History (M7) moves to `H` since `h` is a
motion. Both `r` and `l` first run `checkSelection`
(the wrap rules, no write) and then `wrapSelectionAsReference` / `wrapSelectionAsExternalLink`
with the version the selection was made on; a changed file answers `CONFLICT` and the
selection is dropped, as it is on any reload that brings another version. Unidentified files
cannot be referenced from or selected in.

## 7. Publishing pipeline

`planPublication(config, scope)` is pure: select (vaults → globs → visibility) → assign routes from
the template (`slug` from frontmatter or slugified title) → detect route collisions → classify
every reference as `published`, `excluded` or `unresolved`. Policy for the last two: `fail`
(default) | `strip-to-label` | `keep-id`. Only a plan with zero violations proceeds.

`executePublication(plan)` writes Markdown (reference → relative link) or HTML body fragments
(reference → route `<a>`), plus `manifest.json` (`id, title, route, path, dates, tags`). Source
notes are never opened for writing.

## 8. Testing boundaries

| Layer          | Approach                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| domain         | pure unit tests; property test for `applyEdits`                                                      |
| application    | use cases against in-memory fakes of every port (`test/fakes/`)                                      |
| infrastructure | each adapter against real tmp dirs, real git repos, real SQLite, fixtures in `test/fixtures/`        |
| integration    | spawn the real CLI binary in a tmp vault: init → create → reference → search → export → assert links |
| TUI            | `ink-testing-library` for key maps, screen stack, and rendered↔source mapping; no pixel assertions   |

## 9. Plugins (addendum)

Kinds of notes (todos, goals, expenses, …) are plugins: application-layer code under
`src/plugins/<name>/` that declares owned `type`s, typed fields, commands, doctor checks and TUI
panels as data, and acts only through a narrowed plugin API. The TUI is built on a panel
registry that core screens and plugins share. Full design: [plugins.md](./plugins.md).

## 10. Non-goals (v0.1)

As listed in the specification: no Neovim plugin, GUI, sync, accounts, real-time collaboration,
daemon, graph DB, vector search, AI integration, full SSG, deployment, graph editor, typed
relations, or in-TUI rich text editing.
