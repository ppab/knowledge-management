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

**Toolchain and distribution.** Bun is the package manager (`bun install`, `bun.lock`) and the
script runner (`bun run <script>`); Node ≥ 24 stays the development and test runtime, since
`bun run` executes the tools' own `node` shebangs. Two ways to run `ofl`:

- As a Node package: `bun run build` compiles to `dist/` with `tsc` and `bin/ofl` starts it.
- As a single executable: `bun run compile` (this machine) or `bun run compile:all` (Linux and
  macOS, x64 and arm64) bundles the sources, every dependency and Ink's layout engine (yoga, whose
  wasm is inlined) into `release/ofl-<os>-<arch>` with `bun build --compile`. The binary needs
  no Node: Bun ≥ 1.4 provides `node:sqlite`, so the SQLite index runs unchanged. What stays
  external is what the app shells out to on purpose: the user's `git` and `$EDITOR`. Because a
  bundle has no `package.json` beside it, the version is a constant in
  `src/interfaces/cli/version.ts`, kept equal to the manifest by a test.

Properties:

- **Markdown files are the only authoritative store.** SQLite under `.ofl/cache/` is a
  disposable projection, rebuildable from the files. `.ofl/cache/.gitignore` contains `*`, so
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
- **Revisions are explicit.** Nothing auto-commits. `snapshot` records a revision of exactly one note.

Source tree:

```
src/
├── domain/         vault · scope · note · identity · reference · calendar · revision
│                   · publishing · text-edit
├── application/    vault · notes · references · search · calendar · history · templates
│                   · publishing · index · doctor · ports.ts
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

| Entity                 | Identity                        | Fields                                                                                                                                               |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Vault`                | `VaultId` (ULID, set at `init`) | name, include/exclude globs, identity strategy. Root path is an infrastructure detail.                                                               |
| `Entry`                | `EntryId`                       | title, aliases, dates, tags, visibility, references, opaque extra frontmatter, body                                                                  |
| `UnidentifiedEntry`    | path (vault-relative)           | A Markdown file matched by `include` with no `id`. Listed and searchable; read-only.                                                                 |
| `Template` / `Snippet` | name                            | variables, content; template adds an output path (under the notes directory, `/` anchors at the vault root), snippet adds default insertion location |
| `Publication`          | name                            | vault selection, include/exclude, output dir, route template, reference policy, destination (kind + options)                                         |

### Value objects

- `EntryId` — opaque validated string; equality by value; never rewritten.
- `Alias` — string; compared case-insensitively within a scope; never persisted into references.
- `Reference { target: EntryId, label?: string, range: SourceRange }` — from `[[ID]]` / `[[ID|Label]]`.
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

1. A `EntryId` is assigned once and never rewritten by any operation (rename, move, strategy
   change, re-template).
2. Two documents with the same `EntryId` in one vault ⇒ `DuplicateIdentity`; never a silent pick.
3. Canonical-ID resolution with more than one match across a composite scope ⇒ `Ambiguous`.
4. Alias resolution with more than one candidate ⇒ `Ambiguous`.
5. A reference targets a `EntryId` only; an external URL never becomes a `Reference`.
6. Applying a `TextEdit` set changes nothing outside the edited ranges (property-tested).
7. A composite scope is read-only; `resolveWriteTarget(scope, vaultId?)` yields exactly one vault
   or fails.
8. Date bindings form a set.
9. Two layers of exposure. A note's `visibility` is absolute eligibility: a plan never contains a
   note whose visibility is not `public`, and a publication's include/exclude globs only select
   among eligible notes — a glob can never admit a private one.
10. Unidentified notes cannot be mutated or referenced until adopted.

## 3. Decisions (resolved 2026-10-27)

| #   | Question                        | Decision                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `{type}` in formatted identity  | Taken from the template name (`templates/adr.md` ⇒ `ADR`); overridable by frontmatter `type`. A format referencing an unavailable variable fails config validation.                                                                                                                                                                                       |
| A2  | Files in `include` without `id` | Indexed as unidentified (listed, searchable, read-only). `doctor` reports them; `ofl adopt <path>` assigns an id. Mutations and references require an id.                                                                                                                                                                                                 |
| A3  | Missing `visibility`            | Treated as `private` for publishing (default-deny).                                                                                                                                                                                                                                                                                                       |
| A4  | Commits                         | Never implicit. `snapshot` (TUI `s`, CLI `ofl snapshot <id>`) records a revision of exactly one note via `git add -- <path> && git commit -- <path>`.                                                                                                                                                                                                     |
| A5  | Working copy as revision        | `history` lists commits only; `diff` defaults to last revision → working file.                                                                                                                                                                                                                                                                            |
| A6  | `NotFound` vs `Unavailable`     | `Unavailable` when any vault in the scope could not be opened; otherwise `NotFound`.                                                                                                                                                                                                                                                                      |
| A7  | HTML export shape               | Body fragments + `manifest.json`. Layout belongs to the static site generator.                                                                                                                                                                                                                                                                            |
| A8  | `capture` without template      | Built-in `default` template writing `{{slug}}.md` into the first `include` directory, bound to its creation day (`dates: ["{{date}}"]`); `.ofl/templates/default.md` overrides it.                                                                                                                                                                        |
| A8b | Where `capture` may write       | A template's `template.path` is relative to the notes directory (the first `include` glob's literal prefix); a leading `/` anchors it at the vault root. `--path` is vault-relative. Whatever decides the path, `capture` refuses (exit 6, naming the path and the globs) any file `include`/`exclude` would not index, so a new note is never invisible. |
| A9  | Notes per file                  | Exactly one.                                                                                                                                                                                                                                                                                                                                              |
| A10 | Federated FTS ranking           | BM25 scores are not comparable across indexes. Human views interleave by rank position across vaults; `--json` carries `vault` and `rankInVault`.                                                                                                                                                                                                         |
| A11 | Named scope with a moved vault  | Scopes reference paths; `doctor` and `scope show` flag missing vaults as unavailable. No registry.                                                                                                                                                                                                                                                        |
| A12 | Visual selection                | Restricted to a single mdast `text` node in v0.1.                                                                                                                                                                                                                                                                                                         |

## 4. Application layer

### Use cases

| Area       | Use cases                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vault      | `initVault`, `locateVault`, `loadScope` (named / explicit vault paths / nearest)                                                                                                              |
| notes      | `listNotes`, `showNote`, `createEntry`, `editNote` (external editor), `adoptNote`, `saveNote`                                                                                                 |
| references | `resolveTarget`, `addReference(source, target, location, label?)`, `removeReference(source, range)`, `wrapSelectionAsReference`, `wrapSelectionAsExternalLink`, `listReferences`, `backlinks` |
| search     | `searchNotes(query, scope)`, `lookupByTitleOrAlias`                                                                                                                                           |
| calendar   | `bindDate`, `unbindDate`, `notesOnDate`, `datesInRange`                                                                                                                                       |
| history    | `listRevisions`, `readRevision`, `diffRevisions`, `revisionStatus` (modified since last revision?)                                                                                            |
| templates  | `renderTemplate`, `insertSnippet`                                                                                                                                                             |
| publishing | `planPublication` (pure) → `executePublication`; destinations (markdown / html / astro) render and lay out, the plan is destination-agnostic                                                  |
| index      | `rebuildIndex`, `refreshIndex(paths)`, `indexStatus`                                                                                                                                          |
| doctor     | `diagnose` → duplicate ids, unidentified notes, dangling references, stale index, unavailable vaults                                                                                          |

Use cases return typed results (`Result<T, DomainError>`); expected outcomes are values, not
exceptions.

### Ports (`application/ports.ts`)

| Port                 | Adapter    | Contract                                                                                                                                                                         |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VaultLocator`       | filesystem | `findNearest(cwd)`, `open(path)` → validated config                                                                                                                              |
| `EntryStore`         | filesystem | `list(globs)`, `read(path) → {source, version}`, `write(path, source, {expectedVersion?})` → `Ok                                                                                 | Conflict`, `exists(path)` |
| `MarkdownDocument`   | remark     | `parse(source) → ParsedNote {frontmatterRange, title, headings[], references[], textSpans[]}`; `locate(parsed, InsertionLocation) → offset`; `render → RenderedLine[]`; `toHtml` |
| `FrontmatterCodec`   | yaml       | `read(source)`, `set(source, key, value) → TextEdit` preserving everything else                                                                                                  |
| `EntryIndex`         | sqlite     | `upsert`, `remove`, `clear`, `findById`, `findByAlias`, `findByTitle`, `search`, `byDate`, `outgoing`, `backlinks`, `stats`                                                      |
| `IdentityStrategy`   | identity   | `generate(ctx) → EntryId` for `ulid` / `uuidv7` / `formatted`                                                                                                                    |
| `RevisionProvider`   | git        | `status`, `list` (follows renames), `read(revision)`, `record(path, message)`; an unversioned vault is a status, not an error; diffs are computed in the domain (`unifiedDiff`)  |
| `TemplateRepository` | filesystem | `getTemplate`, `getSnippet`, `list`                                                                                                                                              |
| `OutputStore`        | filesystem | `write(dir, path, content)` for publication output: absolute `dir`, relative POSIX `path` validated inside it, mkdir -p, atomic; never reads, lists or deletes                   |
| `ExternalEditor`     | editor     | `open(file, {command?})` — vault `editor:` → `$VISUAL` → `$EDITOR` → `nvim`; CLI spawns directly, TUI suspends Ink first                                                         |
| `FileWatcher`        | chokidar   | TUI-only; `watch(roots, onChange)` batches `.md` changes per tick, ignores dot directories; the next read refreshes the index                                                    |
| `UserConfig`         | config     | named scopes in `$XDG_CONFIG_HOME/ofl/config.yaml`                                                                                                                               |
| `Clock`              |            |                                                                                                                                                                                  |

### Persistence contracts

**Vault config** `.ofl/config.yaml` (zod-validated):

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
    destination: { kind: html, layout: directory } # or shorthand: destination: markdown
    output: ./dist # vault-relative or absolute
    route: '/{{slug}}/' # vars: slug, id, type, dir, stem
    include: ['docs/**']
    exclude: ['docs/drafts/**']
    references: fail # fail | strip-to-label | keep-id
  blog:
    destination: { kind: astro, theme: modular } # theme fixes route '/posts/{{slug}}/'
    output: ../my-site # the Astro project root
    include: ['posts/**']
    references: strip-to-label
```

**Frontmatter** — recognized keys: `id`, `title`, `created`, `aliases`, `dates`, `tags`, `visibility`, `type`,
`slug`. Everything else is preserved opaquely. Title fallback: `title` → first H1 → filename stem.

**Index schema** (`.ofl/cache/index.sqlite`, keyed by `path` so duplicate ids stay
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

### Using the vault in Obsidian

The vault is plain Markdown and opens in Obsidian unchanged. Two things make our `[[…]]` links
work there, since Obsidian resolves a wikilink against a note's **filename** or frontmatter
**`aliases:`** — never against our `id:` field:

- **Resolution.** `createEntry` records each new note's id in its `aliases:` (id first, deduped),
  so `[[<id>]]` resolves to that note in Obsidian. This is new-notes-only; pre-existing notes
  stay unresolved until re-created or a future backfill. `adopt` is deliberately left untouched
  (its contract is to add nothing but the id).
- **Readable display.** A label-less reference is written `[[<id>|<current title>]]` (the TUI
  `i`/`a`/`I` flows and `link` without `--label`), so Obsidian shows the title, not the
  raw id. Explicit labels and selection-wrapped prose (`r` on a selection) are kept verbatim.

Titles drift, so `relabel <query>` (and `relabel --all`) refreshes the label
of a note's **standalone** links to each target's current title; `--dry-run` previews. `snapshot`
stays a pure recorder (decision A4) and never relabels. "Standalone" is a position heuristic
(`isStandaloneReference`, shared with `removeReference`): a link alone on its line — optionally
behind a `-`/`*`/`1.` bullet — is treated as a managed title-copy and refreshed; a link woven
into a sentence is intentional prose and left alone. Two accepted mis-guesses: an inline link
inserted next to a word is not refreshed, and a standalone link hand-labelled on purpose is
overwritten with the title.

Obsidian setting: keep "Use \[\[Wikilinks\]\]" on (the default).

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
ofl init [--name <n>] [--dir <notes-dir>] [--identity ulid|uuidv7|formatted --format "..."]   # --dir asked for when interactive
ofl list [--tag <t>] [--date <d>|<from>..<to>] [--vault <name>] [--unidentified]
ofl show <id|alias> [--raw] [--at <rev>]
ofl search <words...> [--limit <n>]        # trailing * on a word matches prefixes
ofl capture --template <name> --title <t> [--var k=v]... [--path <p>] [--in <vault>]   # --in: name or path within the scope; --path: vault-relative
ofl edit <id>
ofl adopt <path>... [--type <type>] [--in <vault>]
ofl snapshot <id> [-m <message>]
ofl bind <id> --date <d> [--remove]
ofl link --source <id> --target <id|alias> [--at end|heading:<text>|references] [--label <l>]
ofl references <id>
ofl relabel [<id>] [--all] [--dry-run]   # refresh standalone [[links]] to targets' current titles (Obsidian)
ofl backlinks <id>
ofl snippet insert <id> --snippet <name> [--at ...] [--var k=v]...
ofl history <id>
ofl diff <id> [--from <rev>] [--to <rev>|working]
ofl publish [<name>] [--dry-run]                   # omit name to list the configured publications
ofl index rebuild | status
ofl doctor [--fix]
ofl scope list | show [<name>]
ofl capabilities --json

Global: --scope <name> | --vault <path> (repeatable)  (default: nearest vault from cwd)
        --json  --dry-run  --no-interactive  --cwd <dir>
```

Exit codes: `0` ok · `1` unexpected · `2` usage · `3` not found · `4` ambiguous · `5` conflict ·
`6` validation · `7` vault unavailable. With `--json`, errors are
`{ "error": { "code", "message", "details" } }` on stdout; nothing ever prompts.

## 6. TUI

Screen stack (`push`/`pop`); each screen owns its key map.

**Workspace (decided, implemented in M7.5;
[decision 0003](./decisions/0003-workspace-layout-and-leader-key.md)).** The screen stack
becomes the `main` panel of a workspace made of columns: each column has a width (`1fr`, `28`)
and a vertical stack of panels from the registry, named layouts live in the user configuration
under `tui:`, and columns collapse from the outside in on narrow terminals so a one-column
layout is exactly the TUI described below. One panel has the keyboard; its single letters are
the keys in the table. Everything global sits under a leader (`Space` by default): focus moves
(`Space h/j/k/l`, `Space 1`…`9`), column toggles (`Space t`), the layout picker (`Space L`),
and every panel jump that is a bare letter today (`c` calendar, `m` metadata, `B` backlinks,
`T` todos become `Space c`, `Space m`, `Space B`, `Space T`). A which-key popup after the
leader lists the continuations. Until M7.5 lands, the tables below describe the shipped keys.
Its visual pass is in: colours come from `theme.ts` by role and vanish under `NO_COLOR`; the
footer shows hints as `key label` pairs (key in the accent colour); the cursor row of every
table is marked `▸`; prompts and pickers are rounded bordered dialogs. The leader is in too
(`chords.tsx`): `Space` on any screen opens a which-key popup listing that screen's chords
(home panel jumps, note panel toggles, `b` back, `q` quit); the next key runs one, `Esc` cancels,
an unbound key says so in the status line, and inside a prompt `Space` is a space. The column
workspace itself is still to come.

| Screen     | Keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoteList` | `j/k` move · `g/G` ends · `/` search · `t` tag filter · `Enter` open · `c` create (title, then a template, each row showing the path it would write; `default` alone still asks) · `Space` menu · `Esc` clear filters · `q` quit                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `NoteView` | vim motions `h/j/k/l`, `w/b/e`, `0/^/$`, `{/}`, `gg/G`, `Ctrl-d/u/f/b`, arrows, page keys · `Tab`/`Shift-Tab` next/previous reference · `Enter` follow the one under the cursor · `Ctrl-o`/`Backspace`/`Esc` back · `o` edit (opens the editor) · `s` save revision · `i`/`a` reference before/after the word under the cursor · `I` reference at a location · `x` remove the reference under the cursor (a labelled one leaves its label as prose; a bare one goes with one adjacent space, or its whole list line) · `v` select · `H` history · `Space` menu (`m` metadata, `B` backlinks, plugin panels, `b` back, home panels, `q` quit)                                 |
| selection  | the same motions extend · `v` restart here · `r` reference (opens picker) · `u` external link (prompts URL) · `Esc` cancel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Calendar` | four views on one cursor date, switched with `m` month, `w` week, `y` year, `a` agenda (shown as tabs in the header), plus `d` for the day screen · everywhere: `[`/`]` month, `{`/`}` year, `t` today, `g` go to a date (`YYYY-MM-DD`) or month (`YYYY-MM`), `b` bind a note (picker) to the cursor day · month: `h/j/k/l` move; on 90+ columns the cursor day's notes list beside the grid (`Enter`/`Tab` into the list, `Enter` open, `x` unbind, `Tab`/`h` back), narrower `Enter` opens the day screen · week: `h/l` day, `j/k` week, `Enter` day screen · year: `h/l` day, `j/k` month, `Enter` month view · agenda: `j/k` rows, `Enter` open, `x` unbind · `Esc` back |
| `Day`      | the notes bound to one day with tags and the first two body lines · `j/k` move · `h/l` neighbouring day · `t` today · `Enter` open · `b` bind · `x` unbind · `Esc` back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Picker`   | type to search (scope-wide, interleaved by vault) · `Enter` select → location prompt (end / heading / references) · `Esc`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `History`  | `j/k` · `Enter` view at revision full screen · `d` diff against working · on terminals of 100+ columns the selected revision previews beside the list (its content, or with `d` the diff; `Ctrl-d/u` scroll the preview)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Header shows title, vault, id, and `●` when the file differs from its last revision (or has
none yet); in a versioned vault a two-cell gutter marks the lines changed since the last saved
revision (`▎` added or rewritten, `▁` where lines were deleted), so unsaved work is visible
line by line. The watcher refreshes the index on change; the open note reloads and a pending
selection is invalidated if its version went stale. `s` prompts for a message and records the
note (recorded as `note: <message>`, empty message: `note: save <title>`); `H` opens the history, whose `Enter` shows the note at a
revision read-only and `d` shows a unified diff of that revision against the working file.

As built in M5 and reworked in M7.5: `Esc`, `Backspace` and `Ctrl-o` go back on every pushed
screen (`b` is a motion, never "back"); `g`/`G` jump to the top and bottom; home panels from the
registry (`c` calendar, `T` todos, …) open as screens through the leader (`Space c`, `Space T`).
In `NoteView` a side panel (`Space m`, `Space B`, plugin chords) takes the keyboard while it is
open: `j/k` move its cursor, `Enter` opens the row's note, its action keys run, `Esc` closes it;
a plugin's chordless note panel shows automatically for notes of the types it owns. References
render as the label or the target's title, coloured by resolution and marked `[missing]`,
`[ambiguous]` or `[unavailable]`; `Enter` on one of those explains instead of navigating. The
TUI runs on the alternate screen and refuses to start without a TTY (exit 2). `ofl edit <id>`
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

A **publication** is a named recipe in `.ofl/config.yaml`: a selection (include/exclude globs
over the eligible, `public` notes), a route template, a reference policy, and a **destination**.
The plan is pure and destination-agnostic; the destination decides how entries render and where
their files go.

`planPublication(session, resolved)` builds entirely from the index (no file reads): select
(vaults → visibility → globs) → assign routes from the template (`slug` from frontmatter or
slugified title) → detect route collisions → classify every reference as `published`, `excluded`
or `unresolved`. Policy for the last two: `fail` (default) | `strip-to-label` | `keep-id`. Only a
plan with zero violations and no collisions proceeds.

`executePublication` reads each selected note, rewrites its references for the destination, renders
everything **in memory, then writes** (so a path collision or a render failure aborts before the
first file). Every publication also emits `manifest.json` (`id, title, route, path, dates, tags,
source`). Source notes are only ever read, never written.

**Destinations** are plugin-like modules (a code contract; plugins may add kinds). Each declares
its config **options as data** (`options(chosen?) → OptionSpec[]`, a string/boolean/enum schema),
which the core validates generically and lists under `capabilities` — no destination hand-parses
config. Like a plugin, a destination also declares `FieldSpec`s — frontmatter fields it reads from
the source note — which `doctor` validates on the selected notes. Built-ins:

- **markdown** — a full Markdown file per entry, frontmatter kept verbatim, references → relative
  links. The portable, tool-agnostic output. Option: `layout` (`flat` | `directory`).
- **html** — body fragments (layout belongs to the SSG, A7), references → route `<a>` links.
  Option: `layout`.
- **astro** — Markdown in an Astro content collection. Options: `theme` (a profile) and
  `collection` (one of that theme's collections, a dependent enum). A theme owns the content dir
  and, per collection, its URL route, source fields and frontmatter mapping. Ships `modular`
  ([astro-modular](https://github.com/davidvkimball/astro-modular)) exposing `posts`, `pages`,
  `projects`, `docs`, chosen because it is SEO-ready (sitemap, RSS, OG images, `noIndex`, meta
  description). Themes are pluggable: a plugin contributes one via `astroThemes` and
  `{ kind: astro, theme: <name> }` just works. One publication writes one collection; a second
  collection is a second publication.

See [0006](./decisions/0006-publishing-destinations.md) and
[0007](./decisions/0007-destination-options.md) for the design rationale.

## 8. Testing boundaries

| Layer          | Approach                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| domain         | pure unit tests; property test for `applyEdits`                                                       |
| application    | use cases against in-memory fakes of every port (`test/fakes/`)                                       |
| infrastructure | each adapter against real tmp dirs, real git repos, real SQLite, fixtures in `test/fixtures/`         |
| integration    | spawn the real CLI binary in a tmp vault: init → create → reference → search → publish → assert links |
| TUI            | `ink-testing-library` for key maps, screen stack, and rendered↔source mapping; no pixel assertions    |

## 9. Plugins (addendum)

Kinds of notes (todos, goals, expenses, …) are plugins: application-layer code under
`src/plugins/<name>/` that declares owned `type`s, typed fields, commands, doctor checks and TUI
panels as data, and acts only through a narrowed plugin API. The TUI is built on a panel
registry that core screens and plugins share. Full design: [plugins.md](./plugins.md).

## 10. Non-goals (v0.1)

As listed in the specification: no Neovim plugin, GUI, sync, accounts, real-time collaboration,
daemon, graph DB, vector search, AI integration, full SSG, deployment, graph editor, typed
relations, or in-TUI rich text editing.
