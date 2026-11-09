import type { AppError } from '../../domain/errors.js';
import type { FieldValue } from '../../domain/note/fields.js';
import type { Note } from '../../domain/note/note.js';
import type { Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { BindDateInput } from '../calendar/bind-date.js';
import type { MutationOutcome } from '../mutations/mutate.js';
import type { CreateNoteInput } from '../notes/create-note.js';
import type { ListFilters, ScopedEntry } from '../notes/list-notes.js';
import type { Clock } from '../ports.js';
import type { AddReferenceInput } from '../references/add-reference.js';
import type { LocatedNote } from '../scope/session.js';
import type { SearchOptions, SearchResult } from '../search/search-notes.js';
import type { InsertSnippetInput } from '../snippets/insert-snippet.js';
import type { Destination, ResolvedPublication } from '../publishing/destination.js';
import type { AstroTheme } from '../publishing/destinations/astro.js';

/*
 * The plugin contract (docs/plugins.md). A plugin gives meaning to a kind of note: it owns
 * frontmatter `type` values, declares the fields those notes carry, and contributes commands,
 * doctor checks and TUI panels as data plus pure functions. It reaches the system only through
 * `PluginApi`; the core never imports a plugin.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'list'
  /** The canonical id of another note; a relation the index can follow (docs/plugins.md §2). */
  | 'reference';

export interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
  /** Allowed values when `type` is `enum`. */
  readonly values?: readonly string[];
  /** Element type when `type` is `list` (default `string`). */
  readonly of?: Exclude<FieldType, 'enum' | 'list'>;
  /** A note of an owned type without this field is a `doctor` warning. */
  readonly required?: boolean;
  /** The owned types this field belongs to; omitted means every type the plugin owns. */
  readonly types?: readonly string[];
  readonly description?: string;
}

export interface PluginApi {
  /** The vaults of the caller's scope that enable this plugin. */
  readonly scope: Scope;
  /** What the plugin's `settings()` returned for the first enabling vault in scope order. */
  readonly settings: unknown;
  readonly clock: Clock;
  // Reads, federated over `scope` like the CLI's.
  list(filters?: ListFilters): Promise<Result<ScopedEntry[], AppError>>;
  byField(key: string, value?: string): Promise<Result<ScopedEntry[], AppError>>;
  search(query: string, options?: SearchOptions): Promise<Result<SearchResult[], AppError>>;
  read(query: string): Promise<Result<LocatedNote, AppError>>;
  // Writes; every one goes through the mutation path, dry-run included.
  create(input: CreateNoteInput & { readonly in?: string }): Promise<Result<Note, AppError>>;
  setFields(
    query: string,
    fields: Readonly<Record<string, FieldValue | null>>,
    options?: { readonly dryRun?: boolean },
  ): Promise<Result<MutationOutcome, AppError>>;
  bindDate(input: BindDateInput): Promise<Result<MutationOutcome, AppError>>;
  addReference(input: AddReferenceInput): Promise<Result<MutationOutcome, AppError>>;
  insertSnippet(input: InsertSnippetInput): Promise<Result<MutationOutcome, AppError>>;
}

export interface CommandArg {
  readonly name: string;
  readonly description: string;
  readonly variadic?: boolean;
  readonly optional?: boolean;
}

export interface CommandOption {
  /** Long flag without dashes, e.g. `due`; the CLI exposes it as `--due <value>`. */
  readonly flag: string;
  readonly description: string;
  /** Omitted: a boolean switch. */
  readonly value?: 'string' | 'number' | 'boolean';
}

export interface CommandInput {
  readonly args: readonly string[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly dryRun: boolean;
}

export type CommandOutput =
  | {
      readonly kind: 'table';
      readonly header?: readonly string[];
      readonly rows: readonly (readonly string[])[];
      readonly json: unknown;
      /** Printed instead of an empty table. */
      readonly empty?: string;
    }
  | { readonly kind: 'lines'; readonly lines: readonly string[]; readonly json: unknown }
  | { readonly kind: 'mutation'; readonly outcome: MutationOutcome };

export interface PluginCommand {
  /** `ofl <plugin> <name>`. */
  readonly name: string;
  readonly description: string;
  readonly args?: readonly CommandArg[];
  readonly options?: readonly CommandOption[];
  run(api: PluginApi, input: CommandInput): Promise<Result<CommandOutput, AppError>>;
}

export interface CheckResult {
  readonly severity: 'error' | 'warning' | 'info';
  readonly vault: string;
  readonly path: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PluginCheck {
  /** Reported by `doctor` as `<plugin>:<kind>`. */
  readonly kind: string;
  readonly description: string;
  run(api: PluginApi): Promise<Result<readonly CheckResult[], AppError>>;
}

export type Placement =
  | 'home' // a top-level screen, listed on the start screen and reachable by key
  | 'note' // a side panel inside NoteView, shown for notes the plugin owns (or always)
  | 'list'; // an extra column set / filter in NoteList

export interface PanelNoteRef {
  readonly vault: string;
  readonly path: string;
  readonly id?: string;
}

/**
 * A node in a `tree` panel. Grouping nodes (no `note`/`type`) are pure expand/collapse containers;
 * a node with a `note` opens it on `Enter` and a node with a `type` scopes the leader verbs offered
 * on it. `expanded` is the initial state (default expanded); the viewer's `h`/`l` overrides it.
 */
export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly note?: PanelNoteRef;
  /** The owned type of the node's note, for scoping its verbs; absent on a grouping node. */
  readonly type?: string;
  readonly expanded?: boolean;
  /** Inline per-child verbs shown on the node; each `key` is a `PanelAction`'s. */
  readonly actions?: readonly { readonly key: string; readonly label: string }[];
  readonly children?: readonly TreeNode[];
}

export type PanelData =
  | {
      readonly kind: 'list';
      readonly items: readonly {
        readonly id: string;
        readonly title: string;
        readonly detail?: string;
        readonly note?: PanelNoteRef;
      }[];
    }
  | {
      readonly kind: 'table';
      readonly header: readonly string[];
      readonly rows: readonly { readonly cells: readonly string[]; readonly note?: PanelNoteRef }[];
    }
  | { readonly kind: 'tree'; readonly roots: readonly TreeNode[] }
  | { readonly kind: 'text'; readonly lines: readonly string[] };

export interface PanelContext {
  /** Set for `note` placement. */
  readonly note?: LocatedNote;
  /** The row the cursor is on, as the panel's own data gave it. */
  readonly selection?: unknown;
  /** Values the core collected from the action's `inputs` before running it. */
  readonly inputs?: Readonly<Record<string, string | number>>;
}

/**
 * What a panel action reports: a mutation (the usual edit), `null` for nothing to do, or a plain
 * message — what a *creating* verb returns, since `create` yields a note, not a `MutationOutcome`.
 */
export type PanelActionResult = MutationOutcome | null | { readonly message: string };

/** A value a panel action collects before it runs (the `log` amount, a date); rendered by the core. */
export interface PanelInput {
  readonly name: string;
  readonly label: string;
  readonly type: 'string' | 'number' | 'enum';
  readonly values?: readonly string[];
  readonly default?: string | number;
  readonly required?: boolean;
}

export interface PanelAction {
  readonly key: string;
  readonly label: string;
  /** Node/note types this verb is offered for; every type when absent. */
  readonly appliesTo?: readonly string[];
  /** Where the verb appears on a `tree`: an inline span on the node, or the leader menu (default). */
  readonly surface?: 'inline' | 'menu';
  /** Values to collect before running; absent runs on the key. */
  readonly inputs?: readonly PanelInput[];
  /** Receives the row/node under the cursor and any collected `inputs`. */
  run(api: PluginApi, context: PanelContext): Promise<Result<PanelActionResult, AppError>>;
}

export interface PanelSpec {
  /** `<plugin>.<panel>`; core panels are `core.<panel>`. */
  readonly id: string;
  readonly title: string;
  readonly placement: Placement;
  /** The key after the leader that opens (home) or toggles (note) the panel; absent = unkeyed. */
  readonly chord?: string;
  /** Note panels: show only for owned types (default) or for every note. */
  readonly appliesTo?: 'owned' | 'all';
  load(api: PluginApi, context: PanelContext): Promise<Result<PanelData, AppError>>;
  readonly actions?: readonly PanelAction[];
}

export interface NotePlugin {
  /** Unique; also the CLI namespace (`ofl todos …`) and the config key. */
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
  /** Publication destination kinds this plugin adds; a kind belongs to one plugin or the core. */
  readonly destinations?: readonly Destination[];
  /** Astro theme profiles this plugin adds to the built-in `astro` kind; a name belongs to one. */
  readonly astroThemes?: readonly AstroTheme[];
  /** Validates `plugins.<name>` from `.ofl/config.yaml`; `{}` when the key is bare. */
  readonly settings?: (raw: unknown) => Result<unknown, AppError>;
}

/** A plugin enabled for a scope, with the vaults that enable it and their validated settings. */
export interface EnabledPlugin {
  readonly plugin: NotePlugin;
  /** Members of the caller's scope that enable the plugin, in scope order. */
  readonly scope: Scope;
  /** Validated settings per enabling vault root. */
  readonly settings: ReadonlyMap<string, unknown>;
}

export interface PluginRegistry {
  readonly enabled: readonly EnabledPlugin[];
  readonly plugins: readonly NotePlugin[];
  ownerOf(type: string): NotePlugin | undefined;
  /** The owner's specs that apply to notes of `type`; empty for an unowned type. */
  fieldsFor(type: string): readonly FieldSpec[];
  /** Core panels first, then plugin panels in plugin order. */
  panels(placement: Placement): readonly PanelSpec[];
  commands(): readonly { readonly plugin: NotePlugin; readonly command: PluginCommand }[];
  checks(): readonly { readonly plugin: NotePlugin; readonly check: PluginCheck }[];
  /** Built-in templates of enabled plugins keyed `<plugin>/<name>`. */
  templates(): Readonly<Record<string, string>>;
  /** Destination kinds available to a vault: the built-ins plus those its enabled plugins add. */
  destinationsFor(root: string): readonly Destination[];
  /** Every publication declared by an available vault, resolved and validated. */
  publications(): readonly ResolvedPublication[];
}
