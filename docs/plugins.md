# Architecture Addendum — Plugins

Companion to [architecture.md](./architecture.md). Written 2026-10-27, after M4 and before M5,
so the TUI is built around a registry from its first screen rather than retrofitted.

## 1. What a plugin is

A plugin gives meaning to a kind of note. The core knows ids, titles, aliases, dates, tags,
visibility, references and an opaque bag of `fields`. A plugin says: notes of type `todo` have
a `status` that is one of `open | done`, a `due` date and a `priority` number; here is how to
list the ones due today; here is a panel for the TUI; here is what `doctor` should complain
about. Nothing a plugin does changes the data model: a todo is still a Markdown file with
frontmatter, listed, searched, referenced and published like any other note.

Principles, in the order they win:

1. **Files stay plain.** A plugin never introduces storage, a sidecar, or a frontmatter
   encoding the core cannot read. If the plugin is removed, the notes lose nothing but a view.
2. **Plugins are application code.** They live under `src/plugins/<name>/` and obey the same
   layer rules as `src/application/`: domain and application imports only, no packages, no
   `node:` builtins, no Ink, no commander, no SQLite. Everything they need arrives through the
   plugin API below.
3. **Plugins declare, the core renders.** Commands, panels and checks are data plus pure
   functions returning data. The CLI turns command output into text or JSON; the TUI turns
   panel data into widgets; `doctor` turns check results into findings. A plugin never prints
   and never draws.
4. **The core never imports a plugin.** The registry type lives in the application layer; the
   concrete list of plugins is assembled at the composition root (`src/plugins/index.ts`, imported
   only by the interfaces). ESLint enforces this like every other boundary.
5. **No dynamic loading in v0.1.** First-party plugins are compiled in and switched on per vault
   in `.notes/config.yaml`. Third-party loading would need a stable API and a security story;
   it is a non-goal until the API has survived at least one release.

## 2. Declared fields

M2 already indexes every frontmatter key the core does not interpret (`fields(path, key,
value, kind)`, `EntrySummary.fields`, `NoteIndex.byField`). A plugin adds the schema:

```ts
// src/application/plugin/plugin.ts
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'list';

export interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
  /** Allowed values when `type` is `enum`; element type when `list` (default `string`). */
  readonly values?: readonly string[];
  readonly of?: Exclude<FieldType, 'enum' | 'list'>;
  /** A note of an owned type without this field is a `doctor` warning. */
  readonly required?: boolean;
  readonly description?: string;
}
```

Declared fields have three effects, all implemented once in the core:

- **Validation.** `doctor` checks every note whose `type` is owned by an enabled plugin against
  the plugin's specs: unknown enum value, non-numeric amount, malformed date, missing required
  field. Finding kind `field`, severity `warning`; never an error, because the file is still a
  valid note.
- **Typed queries.** `byField(key, value)` compares strings today. Declared numbers and dates
  get `byFieldRange(key, from, to)` in the index, backed by the existing `fields` table (`kind`
  already distinguishes `number`), so "expenses over 100 this month" is one query.
- **Display.** The TUI metadata panel and `show` print declared fields with their types and
  flag undeclared ones on owned notes.

A field name declared by two enabled plugins with different types is a configuration error
(`VALIDATION`, exit 6) at vault open. The same declaration twice is fine.

## 3. The `NotePlugin` interface

```ts
export interface NotePlugin {
  /** Unique; also the CLI namespace (`notes todos …`) and the config key. */
  readonly name: string;
  readonly description: string;
  /** Frontmatter `type` values this plugin owns. A type belongs to at most one plugin. */
  readonly types: readonly string[];
  readonly fields: readonly FieldSpec[];
  /** Built-in templates, reachable as `--template <plugin>/<name>`; vault templates win. */
  readonly templates?: Readonly<Record<string, string>>;
  readonly commands?: readonly PluginCommand[];
  readonly checks?: readonly PluginCheck[];
  readonly panels?: readonly PanelSpec[];
  /** Validates `plugins.<name>` from `.notes/config.yaml`; `{}` when the key is bare. */
  readonly settings?: (raw: unknown) => Result<unknown, AppError>;
}
```

### Plugin API

Plugins receive one object and nothing else. It is the application layer's public surface,
narrowed so a plugin cannot reach a port directly:

```ts
export interface PluginApi {
  readonly scope: Scope;
  readonly settings: unknown; // what `settings()` returned
  readonly clock: Clock;
  // Reads (federated over the scope, like the CLI):
  list(filters?: ListFilters): Promise<Result<ScopedEntry[], AppError>>;
  byField(key: string, value?: string): Promise<Result<ScopedEntry[], AppError>>;
  search(query: string, options?: SearchOptions): Promise<Result<SearchResult[], AppError>>;
  read(query: string): Promise<Result<LocatedNote, AppError>>;
  // Writes (every one goes through the M3 mutation path, dry-run included):
  create(input: CreateNoteInput & { in?: string }): Promise<Result<Note, AppError>>;
  setFields(
    query: string,
    fields: Record<string, FieldValue | null>,
    options?: { dryRun?: boolean },
  ): Promise<Result<MutationOutcome, AppError>>;
  bindDate(input: BindDateInput): Promise<Result<MutationOutcome, AppError>>;
  addReference(input: AddReferenceInput): Promise<Result<MutationOutcome, AppError>>;
  insertSnippet(input: InsertSnippetInput): Promise<Result<MutationOutcome, AppError>>;
}
```

`setFields` is the one new use case: a frontmatter-only mutation (`frontmatter: 'changed'`,
reference delta 0) that sets or removes keys through the YAML codec, exactly like `bind` does
for `dates`. It is what a todo's `done` or an expense's `amount` edit becomes.

### Commands

```ts
export interface PluginCommand {
  readonly name: string; // `notes <plugin> <name>`
  readonly description: string;
  readonly args?: readonly {
    name: string;
    description: string;
    variadic?: boolean;
    optional?: boolean;
  }[];
  readonly options?: readonly {
    flag: string;
    description: string;
    value?: 'string' | 'number' | 'boolean';
  }[];
  run(
    api: PluginApi,
    input: { args: string[]; options: Record<string, unknown>; dryRun: boolean },
  ): Promise<Result<CommandOutput, AppError>>;
}

export type CommandOutput =
  | {
      readonly kind: 'table';
      readonly header?: readonly string[];
      readonly rows: readonly string[][];
      readonly json: unknown;
    }
  | { readonly kind: 'lines'; readonly lines: readonly string[]; readonly json: unknown }
  | { readonly kind: 'mutation'; readonly outcome: MutationOutcome };
```

The CLI registers each plugin as a command group from this description. Global flags
(`--scope`, `--vault`, `--json`, `--dry-run`, `--cwd`) work unchanged; errors map to the same
exit codes. Plugin commands appear in `capabilities --json` under their plugin.

### Checks

```ts
export interface PluginCheck {
  readonly kind: string; // namespaced by the core as `<plugin>:<kind>`
  run(api: PluginApi): Promise<Result<readonly CheckResult[], AppError>>;
}
export interface CheckResult {
  readonly severity: 'error' | 'warning' | 'info';
  readonly vault: string;
  readonly path: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

`doctor` runs declared-field validation first, then every enabled plugin's checks, and merges
the results into its findings. A plugin check cannot make `doctor` exit non-zero unless it
reports an `error`.

## 4. TUI panel registry

The TUI (M5) is a screen stack whose screens render **panels**. Core panels (note body,
metadata, backlinks, calendar, history) and plugin panels are the same kind of thing, so the
registry exists before any plugin does.

```ts
export type Placement =
  | 'home' // a top-level screen, listed on the start screen and reachable by key
  | 'note' // a side panel inside NoteView, shown for notes the plugin owns (or always)
  | 'list'; // an extra column set / filter in NoteList

export interface PanelSpec {
  readonly id: string; // `<plugin>.<panel>`; core panels are `core.<panel>`
  readonly title: string;
  readonly placement: Placement;
  /** Home screens: the key on the start screen. Note panels: the toggle key in NoteView. */
  readonly key?: string;
  /** Note panels: show only for owned types (default) or for every note. */
  readonly appliesTo?: 'owned' | 'all';
  load(api: PluginApi, context: PanelContext): Promise<Result<PanelData, AppError>>;
  readonly actions?: readonly PanelAction[];
}

export interface PanelContext {
  readonly note?: LocatedNote; // set for `note` placement
  readonly selection?: unknown; // the row the cursor is on, as the panel's data gave it
}

export type PanelData =
  | {
      readonly kind: 'list';
      readonly items: readonly {
        id: string;
        title: string;
        detail?: string;
        note?: { vault: string; path: string; id?: string };
      }[];
    }
  | {
      readonly kind: 'table';
      readonly header: readonly string[];
      readonly rows: readonly {
        cells: readonly string[];
        note?: { vault: string; path: string; id?: string };
      }[];
    }
  | { readonly kind: 'text'; readonly lines: readonly string[] };

export interface PanelAction {
  readonly key: string;
  readonly label: string;
  /** Receives the row under the cursor; returns a mutation outcome the TUI reports. */
  run(api: PluginApi, context: PanelContext): Promise<Result<MutationOutcome | null, AppError>>;
}
```

Rules the TUI enforces for every panel, core or plugin:

- A `list` or `table` row that carries a `note` can be opened with `Enter` (push `NoteView`).
- Panel actions run through `PluginApi`, so they inherit conflict detection, dry-run and index
  refresh; the TUI shows the outcome and reloads the panel.
- Key collisions are resolved at registry build time: a plugin key that clashes with a core key
  or another plugin's key is a startup error naming both, never a silent override.
- Panels are loaded lazily when shown and reloaded on the watcher tick that touches a note they
  displayed.
- Keys the screens bind themselves (`j`, `k`, `/`, `t`, `n`, `q`, `e`, `s`, `H`, the note
  cursor's motions, `i`/`a`/`I`, `v`, …) are reserved; a plugin panel claiming one is a startup
  error too.
- A note panel without a key shows automatically for notes of the plugin's own types; a keyed
  one toggles. While a side panel is open it has the keyboard (`j/k`, `Enter`, its actions,
  `Esc` closes). The `list` placement is reserved and not rendered yet (M5).

The registry itself:

```ts
export interface PluginRegistry {
  readonly plugins: readonly NotePlugin[]; // enabled for this scope's vaults
  ownerOf(type: string): NotePlugin | undefined;
  fieldsFor(type: string): readonly FieldSpec[];
  panels(placement: Placement): readonly PanelSpec[];
  commands(): readonly { plugin: NotePlugin; command: PluginCommand }[];
  checks(): readonly { plugin: NotePlugin; check: PluginCheck }[];
}
```

Built once per command from the composition root's plugin list and the vault configs in the
scope. In a composite scope, a plugin is enabled if any vault enables it; its panels only
show notes from vaults that enable it.

## 5. Configuration

```yaml
# .notes/config.yaml
plugins:
  todos: {} # enabled, default settings
  expenses:
    currency: EUR # validated by the plugin's `settings()`
```

No key means no plugins. `notes capabilities --json` lists enabled plugins, their types, fields,
commands and panels, so an agent can discover them without reading this document.

## 6. Source layout and boundaries

```
src/plugins/
├── index.ts              # firstPartyPlugins: NotePlugin[]  (imported by interfaces only)
├── todos/
│   ├── plugin.ts         # the NotePlugin object
│   ├── queries.ts        # pure functions over ScopedEntry[] / fields
│   ├── templates.ts
│   └── plugin.test.ts    # against test/fakes, like any use case
└── expenses/ …
src/application/plugin/   # singular, so the lint rule against importing `plugins` cannot match it
├── plugin.ts             # the interfaces above
├── registry.ts           # buildRegistry(plugins, scope) → Result<PluginRegistry>
├── api.ts                # createPluginApi(deps, scope, settings) — the only place plugins get deps
├── set-fields.ts         # the new mutation use case
└── validate-fields.ts    # declared-field validation used by doctor and show
```

ESLint additions: `src/plugins/**` may import `domain`, `application` and its own relative
modules, nothing else; `src/domain/**`, `src/application/**` and `src/infrastructure/**` may
not import `plugins`. The layer-boundary test gains both cases.

## 7. First-party candidates

Illustrative, not a commitment; each one is a separate milestone with its own acceptance.

| Plugin     | Owned type | Fields                                                      | Commands                                      | Panels                                          |
| ---------- | ---------- | ----------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `todos`    | `todo`     | `status: enum(open, done)`, `due: date`, `priority: number` | `todos list [--due today]`, `todos done <id>` | home `Todos` (`T`), note panel for linked todos |
| `goals`    | `goal`     | `target: date`, `progress: number`, `status: enum`          | `goals list`, `goals progress <id> <n>`       | home `Goals` (`G`)                              |
| `expenses` | `expense`  | `amount: number`, `category: string`, `account: string`     | `expenses list [--month]`, `expenses total`   | home `Expenses` (`E`), monthly table            |

All three use `dates:` for their calendar date, so they appear in the core calendar for free.

## 8. Plan impact

A new milestone **M4.5 — Plugin core** goes between M4 and M5: interfaces, registry, plugin API,
`setFields`, declared-field validation in `doctor` and `show`, config key, ESLint rule,
`capabilities` entry, and the `todos` plugin as the first vertical slice through CLI and doctor.
M5 then builds `NoteList`/`NoteView` on the panel registry (core panels registered the same way)
and renders `todos`' panels as its proof. Details in [plan.md](./plan.md).
