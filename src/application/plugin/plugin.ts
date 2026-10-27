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

/*
 * The plugin contract (docs/plugins.md). A plugin gives meaning to a kind of note: it owns
 * frontmatter `type` values, declares the fields those notes carry, and contributes commands,
 * doctor checks and TUI panels as data plus pure functions. It reaches the system only through
 * `PluginApi`; the core never imports a plugin.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'list';

export interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
  /** Allowed values when `type` is `enum`. */
  readonly values?: readonly string[];
  /** Element type when `type` is `list` (default `string`). */
  readonly of?: Exclude<FieldType, 'enum' | 'list'>;
  /** A note of an owned type without this field is a `doctor` warning. */
  readonly required?: boolean;
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
  /** `notes <plugin> <name>`. */
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
  | { readonly kind: 'text'; readonly lines: readonly string[] };

export interface PanelContext {
  /** Set for `note` placement. */
  readonly note?: LocatedNote;
  /** The row the cursor is on, as the panel's own data gave it. */
  readonly selection?: unknown;
}

export interface PanelAction {
  readonly key: string;
  readonly label: string;
  /** Receives the row under the cursor; `null` when there was nothing to do. */
  run(api: PluginApi, context: PanelContext): Promise<Result<MutationOutcome | null, AppError>>;
}

export interface PanelSpec {
  /** `<plugin>.<panel>`; core panels are `core.<panel>`. */
  readonly id: string;
  readonly title: string;
  readonly placement: Placement;
  /** Home screens: the key on the start screen. Note panels: the toggle key in NoteView. */
  readonly key?: string;
  /** Note panels: show only for owned types (default) or for every note. */
  readonly appliesTo?: 'owned' | 'all';
  load(api: PluginApi, context: PanelContext): Promise<Result<PanelData, AppError>>;
  readonly actions?: readonly PanelAction[];
}

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
  fieldsFor(type: string): readonly FieldSpec[];
  /** Core panels first, then plugin panels in plugin order. */
  panels(placement: Placement): readonly PanelSpec[];
  commands(): readonly { readonly plugin: NotePlugin; readonly command: PluginCommand }[];
  checks(): readonly { readonly plugin: NotePlugin; readonly check: PluginCheck }[];
  /** Built-in templates of enabled plugins keyed `<plugin>/<name>`. */
  templates(): Readonly<Record<string, string>>;
}
